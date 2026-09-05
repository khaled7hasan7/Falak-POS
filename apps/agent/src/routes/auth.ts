import { loginRequest, pinLoginRequest } from '@falak/contracts'
import { roles, users } from '@falak/db'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import {
  AuthError,
  authenticatePassword,
  authenticatePin,
  issueSession,
  type SessionUserRow,
} from '../auth/session.js'
import { PERMISSIONS } from '../auth/permissions.js'

/**
 * مسارات المصادقة (`docs/01-project-and-permissions.md §5`).
 * هذه المسارات **عامة بوعي** — هي باب الدخول نفسه.
 */

/** الأدوار التي تدخل بـ PIN من شاشة الكاشير (§5: الكاشير وأمين المخزن) */
const PIN_ROLES = ['cashier', 'stock_keeper']

function toSessionUser(user: SessionUserRow) {
  return {
    id: user.id,
    fullName: user.fullName,
    username: user.username,
    branchId: user.branchId,
    role: {
      id: user.role.id,
      name: user.role.name,
      isSystem: user.role.isSystem,
      permissions: user.role.permissions,
    },
  }
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const { jwtSecret, sessionTtlHours } = app.config

  /** بطاقات الدخول السريع: من يدخل بـ PIN فقط، بلا أي بيانات حساسة */
  app.get('/pin-users', async () => {
    const rows = await app.db
      .select({
        id: users.id,
        fullName: users.fullName,
        roleName: roles.name,
      })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(
        and(
          isNull(users.deletedAt),
          eq(users.isActive, true),
          sql`${users.pinHash} IS NOT NULL`,
          inArray(roles.name, PIN_ROLES)
        )
      )
      .orderBy(users.fullName)

    return { users: rows }
  })

  app.post('/login', async (request, reply) => {
    const parsed = loginRequest.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'invalid_input', message: 'أدخل اسم المستخدم وكلمة المرور.' },
      })
    }

    try {
      const user = await authenticatePassword(app.db, parsed.data.username, parsed.data.password)
      const session = await issueSession(user, jwtSecret, sessionTtlHours)
      await touchLastLogin(app, user.id)

      return {
        token: session.token,
        expiresAt: session.expiresAt.toISOString(),
        user: toSessionUser(user),
      }
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(401).send({ error: { code: error.reason, message: error.message } })
      }
      throw error
    }
  })

  app.post('/pin', async (request, reply) => {
    const parsed = pinLoginRequest.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'invalid_input', message: 'الرمز من 4 إلى 6 أرقام.' },
      })
    }

    try {
      const user = await authenticatePin(app.db, parsed.data.userId, parsed.data.pin)
      const session = await issueSession(user, jwtSecret, sessionTtlHours)
      await touchLastLogin(app, user.id)

      return {
        token: session.token,
        expiresAt: session.expiresAt.toISOString(),
        user: toSessionUser(user),
      }
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(401).send({ error: { code: error.reason, message: error.message } })
      }
      throw error
    }
  })

  /** الجلسة الحالية — تستعملها الواجهة عند الإقلاع لتعرف من الداخل وبأي صلاحيات */
  app.get(
    '/me',
    { onRequest: app.requirePermission(PERMISSIONS.PRODUCTS_VIEW) },
    async (request) => {
      const session = request.session!
      const [row] = await app.db
        .select({
          id: users.id,
          fullName: users.fullName,
          username: users.username,
          branchId: users.branchId,
          roleId: roles.id,
          roleName: roles.name,
          roleIsSystem: roles.isSystem,
          rolePermissions: roles.permissions,
        })
        .from(users)
        .innerJoin(roles, eq(roles.id, users.roleId))
        .where(and(eq(users.id, session.sub), isNull(users.deletedAt)))
        .limit(1)

      if (!row) {
        throw Object.assign(new Error('غير موجود — ربما حُذف.'), { statusCode: 404 })
      }

      return {
        user: {
          id: row.id,
          fullName: row.fullName,
          username: row.username,
          branchId: row.branchId,
          role: {
            id: row.roleId,
            name: row.roleName,
            isSystem: row.roleIsSystem,
            permissions: row.rolePermissions,
          },
        },
      }
    }
  )
}

/** آخر دخول — معلومة تشغيلية، ليست حدثاً مالياً فلا تحتاج audit/outbox */
async function touchLastLogin(app: FastifyInstance, userId: string): Promise<void> {
  await app.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId))
}
