import { connect } from '@falak/db'
import type { Database } from '@falak/db'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import Fastify from 'fastify'
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Pool } from 'pg'
import type { AgentConfig } from './config.js'
import { can } from './auth/permissions.js'
import { verifySession, type SessionClaims } from './auth/session.js'
import { authRoutes } from './routes/auth.js'
import { catalogRoutes } from './routes/catalog.js'
import { productRoutes } from './routes/products.js'
import { importRoutes } from './routes/import.js'

/**
 * الوكيل المحلي — API واحد يخدم كل أجهزة المحل عبر LAN
 * (`docs/adr/ADR-001-architecture.md` قرار 2).
 */

declare module 'fastify' {
  interface FastifyInstance {
    db: Database
    pool: Pool
    config: AgentConfig
    /** حارس مسار: يرفض 403 قبل الوصول للمعالج (القاعدة 6) */
    requirePermission: (
      permission: string
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
  interface FastifyRequest {
    /** ادّعاءات الجلسة — موجودة بعد `authenticate` */
    session?: SessionClaims
  }
}

/** حجم ملف الاستيراد الأقصى — 500 صنف ≈ 190KB، فعشرة ميغابايت هامش واسع */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export interface BuildOptions {
  config: AgentConfig
  /** اتصال جاهز — تستعمله الاختبارات لتمرير قاعدة الاختبار */
  connection?: { db: Database; pool: Pool; close: () => Promise<void> }
}

export async function buildApp({ config, connection }: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.isProduction ? { level: 'info' } : { level: 'warn', transport: undefined },
    // الأرقام المالية تصل نصوصاً (ADR-002) فلا يفسدها JSON.parse
    bodyLimit: MAX_UPLOAD_BYTES,
  })

  const connected = connection ?? connect(config.databaseUrl)

  app.decorate('db', connected.db)
  app.decorate('pool', connected.pool)
  app.decorate('config', config)

  app.addHook('onClose', async () => {
    await connected.close()
  })

  await app.register(cors, {
    // أجهزة المحل على الشبكة المحلية؛ لا سحابة تتصل بهذا المنفذ
    origin: true,
    credentials: true,
  })
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES } })

  /** يقرأ الجلسة من ترويسة Authorization ويضعها على الطلب */
  app.decorateRequest('session', undefined)

  app.addHook('onRequest', async (request) => {
    const header = request.headers.authorization
    if (!header?.startsWith('Bearer ')) return
    const claims = await verifySession(header.slice(7), config.jwtSecret)
    if (claims) request.session = claims
  })

  /**
   * حارس الصلاحيات. يُلحق بكل مسار يحتاج صلاحية — والمسار بلا حارس يجب أن
   * يكون عاماً بوعي (الدخول فقط).
   */
  app.decorate('requirePermission', (permission: string) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.session) {
        await reply.code(401).send({
          error: {
            code: 'unauthenticated',
            message: 'انتهت جلستك. سجّل الدخول مرة أخرى للمتابعة.',
          },
        })
        return
      }

      if (!can(request.session.permissions, permission)) {
        request.log.warn(
          { userId: request.session.sub, permission, path: request.url },
          'permission denied'
        )
        await reply.code(403).send({
          error: {
            code: 'forbidden',
            message: 'لا تملك صلاحية هذه العملية. اطلب من المدير تنفيذها.',
          },
        })
      }
    }
  })

  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500
    if (status >= 500) request.log.error({ err: error }, 'unhandled error')

    await reply.code(status).send({
      error: {
        code: error.code ?? 'internal_error',
        message:
          status >= 500 ? 'خطأ غير متوقع. أعد المحاولة، وإن تكرر أبلغ الدعم.' : error.message,
      },
    })
  })

  app.setNotFoundHandler(async (_request, reply) => {
    await reply.code(404).send({
      error: { code: 'not_found', message: 'غير موجود — ربما حُذف.' },
    })
  })

  app.get('/health', async () => ({ ok: true }))

  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(catalogRoutes, { prefix: '/api' })
  await app.register(productRoutes, { prefix: '/api/products' })
  await app.register(importRoutes, { prefix: '/api/import' })

  return app
}
