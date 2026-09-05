import { verify as verifyHash } from '@node-rs/argon2'
import { roles, users } from '@falak/db'
import type { Database } from '@falak/db'
import { and, eq, isNull } from 'drizzle-orm'
import { SignJWT, jwtVerify } from 'jose'

/**
 * المصادقة والجلسة المحلية.
 *
 * `docs/01-project-and-permissions.md §5`: كلمة مرور (argon2) للمالك والمدير
 * والمحاسب، و**PIN** من 4–6 أرقام للكاشير وأمين المخزن للدخول السريع من شاشة
 * الكاشير. الجلسة JWT محلي قصير — لا علاقة له بترخيص السحابة (ذاك EdDSA في M4).
 */

/** خوارزمية التوقيع للجلسة المحلية: سر متماثل يعيش على جهاز المحل وحده */
const ALGORITHM = 'HS256'

export interface SessionClaims {
  /** معرّف المستخدم */
  sub: string
  tenantId: string
  roleId: string
  branchId: string | null
  permissions: string[]
}

export interface SessionUserRow {
  id: string
  tenantId: string
  fullName: string
  username: string
  branchId: string | null
  role: { id: string; name: string; isSystem: boolean; permissions: string[] }
}

/**
 * سبب فشل الدخول — الرسالة الظاهرة **لا تكشف** أيّهما فشل (المستخدم أم كلمة
 * المرور)، فلا تساعد من يخمّن أسماء المستخدمين.
 */
export class AuthError extends Error {
  constructor(
    readonly reason: 'invalid_credentials' | 'account_disabled',
    message: string
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

const INVALID_CREDENTIALS = 'اسم المستخدم أو كلمة المرور غير صحيحة. تأكد منهما وأعد المحاولة.'
const INVALID_PIN = 'الرمز غير صحيح. أعد إدخاله أو اطلب من المدير إعادة ضبطه.'
const DISABLED = 'هذا الحساب موقوف. راجع المدير لتفعيله.'

/** يقرأ المستخدم بدوره وصلاحياته. القاعدة 1: `deleted_at IS NULL` دائماً. */
async function loadUser(
  db: Database,
  where: ReturnType<typeof eq>
): Promise<
  | (SessionUserRow & { passwordHash: string | null; pinHash: string | null; isActive: boolean })
  | null
> {
  const [row] = await db
    .select({
      id: users.id,
      tenantId: users.tenantId,
      fullName: users.fullName,
      username: users.username,
      branchId: users.branchId,
      isActive: users.isActive,
      passwordHash: users.passwordHash,
      pinHash: users.pinHash,
      roleId: roles.id,
      roleName: roles.name,
      roleIsSystem: roles.isSystem,
      rolePermissions: roles.permissions,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(where, isNull(users.deletedAt), isNull(roles.deletedAt)))
    .limit(1)

  if (!row) return null

  return {
    id: row.id,
    tenantId: row.tenantId,
    fullName: row.fullName,
    username: row.username,
    branchId: row.branchId,
    isActive: row.isActive,
    passwordHash: row.passwordHash,
    pinHash: row.pinHash,
    role: {
      id: row.roleId,
      name: row.roleName,
      isSystem: row.roleIsSystem,
      permissions: row.rolePermissions,
    },
  }
}

/**
 * تجزئة وهمية للمقارنة عند عدم وجود المستخدم — تجعل زمن الرد ثابتاً تقريباً
 * فلا يُستدل على وجود اسم مستخدم من سرعة الرفض (توقيت جانبي).
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$Z0Z5cGljYWxkdW1teWhhc2h2YWx1ZQ'

async function safeVerify(hash: string | null, candidate: string): Promise<boolean> {
  try {
    return await verifyHash(hash ?? DUMMY_HASH, candidate)
  } catch {
    // تجزئة تالفة أو صيغة غير متوقّعة ⇒ رفض، لا انهيار
    return false
  }
}

/** دخول بكلمة مرور (`docs/01 §5`) */
export async function authenticatePassword(
  db: Database,
  username: string,
  password: string
): Promise<SessionUserRow> {
  const user = await loadUser(db, eq(users.username, username))
  const matched = await safeVerify(user?.passwordHash ?? null, password)

  if (!user || !matched) throw new AuthError('invalid_credentials', INVALID_CREDENTIALS)
  if (!user.isActive) throw new AuthError('account_disabled', DISABLED)
  return user
}

/** دخول سريع بـ PIN — الكاشير يختار اسمه من الشاشة ثم يُدخل رمزه */
export async function authenticatePin(
  db: Database,
  userId: string,
  pin: string
): Promise<SessionUserRow> {
  const user = await loadUser(db, eq(users.id, userId))
  const matched = await safeVerify(user?.pinHash ?? null, pin)

  if (!user || !matched) throw new AuthError('invalid_credentials', INVALID_PIN)
  if (!user.isActive) throw new AuthError('account_disabled', DISABLED)
  return user
}

export interface IssuedSession {
  token: string
  expiresAt: Date
}

export async function issueSession(
  user: SessionUserRow,
  secret: string,
  ttlHours: number
): Promise<IssuedSession> {
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000)
  const key = new TextEncoder().encode(secret)

  const token = await new SignJWT({
    tenantId: user.tenantId,
    roleId: user.role.id,
    branchId: user.branchId,
    permissions: user.role.permissions,
  })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(key)

  return { token, expiresAt }
}

/** يتحقق من الجلسة ويعيد ادّعاءاتها، أو `null` إن كانت منتهية أو مزوّرة */
export async function verifySession(token: string, secret: string): Promise<SessionClaims | null> {
  try {
    const key = new TextEncoder().encode(secret)
    const { payload } = await jwtVerify(token, key, { algorithms: [ALGORITHM] })
    if (typeof payload.sub !== 'string' || typeof payload.tenantId !== 'string') return null

    return {
      sub: payload.sub,
      tenantId: payload.tenantId,
      roleId: String(payload.roleId ?? ''),
      branchId: (payload.branchId as string | null) ?? null,
      permissions: Array.isArray(payload.permissions) ? (payload.permissions as string[]) : [],
    }
  } catch {
    return null
  }
}
