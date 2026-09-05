import { connect, ensureTestDatabase, runMigrations } from '@falak/db'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.js'
import type { AgentConfig } from '../config.js'

/**
 * أدوات اختبارات الوكيل: تطبيق حقيقي فوق قاعدة اختبار حقيقية.
 * لا محاكاة للقاعدة — الصلاحيات والقيود والتريجرات جزء من السلوك المُختبَر.
 */

const DROP_AND_RECREATE = `
  DROP SCHEMA IF EXISTS public CASCADE;
  CREATE SCHEMA public;
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
`

export const TEST_CONFIG: AgentConfig = {
  databaseUrl: '',
  host: '127.0.0.1',
  port: 0,
  jwtSecret: 'test_secret_at_least_thirty_two_characters_long',
  sessionTtlHours: 1,
  isProduction: false,
}

export interface TestApp {
  app: FastifyInstance
  close: () => Promise<void>
}

/** يبني القاعدة من الترحيلات ويشغّل تطبيقاً فوقها */
export async function createTestApp(): Promise<TestApp> {
  // قاعدة خاصة بالوكيل، منفصلة عن قاعدة اختبارات packages/db
  const url = await ensureTestDatabase('agent')
  const connection = connect(url)

  await connection.pool.query(DROP_AND_RECREATE)
  await runMigrations(connection.pool)

  const app = await buildApp({
    config: { ...TEST_CONFIG, databaseUrl: url },
    connection,
  })
  await app.ready()

  return {
    app,
    close: async () => {
      // `app.close()` يستدعي onClose الذي يُغلق الاتصال
      await app.close()
    },
  }
}

/** رابط قاعدة اختبار الوكيل — تحتاجه الاختبارات لبذر البيانات */
export async function agentTestDatabaseUrl(): Promise<string> {
  return ensureTestDatabase('agent')
}

export interface LoggedIn {
  token: string
  userId: string
  permissions: string[]
}

/** دخول بكلمة مرور ويعيد ما يلزم لبقية الطلبات */
export async function loginWithPassword(
  app: FastifyInstance,
  username: string,
  password: string
): Promise<LoggedIn> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
  })

  if (response.statusCode !== 200) {
    throw new Error(`فشل الدخول (${response.statusCode}): ${response.body}`)
  }

  const body = response.json<{
    token: string
    user: { id: string; role: { permissions: string[] } }
  }>()
  return { token: body.token, userId: body.user.id, permissions: body.user.role.permissions }
}

/** دخول بـ PIN — مسار الكاشير من شاشة الدخول السريع */
export async function loginWithPin(
  app: FastifyInstance,
  userId: string,
  pin: string
): Promise<LoggedIn> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/pin',
    payload: { userId, pin },
  })

  if (response.statusCode !== 200) {
    throw new Error(`فشل الدخول بـ PIN (${response.statusCode}): ${response.body}`)
  }

  const body = response.json<{
    token: string
    user: { id: string; role: { permissions: string[] } }
  }>()
  return { token: body.token, userId: body.user.id, permissions: body.user.role.permissions }
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` })
