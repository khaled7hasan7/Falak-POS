import { z } from 'zod'
import { uuid } from './primitives.js'

/** المصادقة والجلسة. المرجع: docs/01-project-and-permissions.md §5 و§6. */

/** أدوار النظام الخمسة التي تُنشأ لكل مستأجر (01 §5). */
export const systemRoles = ['owner', 'manager', 'cashier', 'stock_keeper', 'accountant'] as const
export const systemRole = z.enum(systemRoles)
export type SystemRole = z.infer<typeof systemRole>

/**
 * صلاحية بصيغة `module.action` أو `module.action:limit` (01 §6).
 * المثال: `pos.discount_line:10` = خصم سطر حتى 10% بلا موافقة.
 */
export const permission = z
  .string()
  .regex(
    /^[a-z_]+\.[a-z_]+(\*|)(:\d+(\.\d+)?)?$/,
    'صيغة الصلاحية: module.action أو module.action:limit'
  )
export type Permission = z.infer<typeof permission>

export const loginRequest = z.object({
  username: z.string().min(1, 'اسم المستخدم مطلوب').max(64),
  password: z.string().min(1, 'كلمة المرور مطلوبة').max(256),
})
export type LoginRequest = z.infer<typeof loginRequest>

export const pinLoginRequest = z.object({
  userId: uuid,
  pin: z.string().regex(/^\d{4,6}$/, 'الرمز من 4 إلى 6 أرقام'),
})
export type PinLoginRequest = z.infer<typeof pinLoginRequest>

/** المستخدم كما تراه الواجهة — بلا أي هاش. */
export const sessionUser = z.object({
  id: uuid,
  fullName: z.string(),
  username: z.string(),
  branchId: uuid.nullable(),
  role: z.object({
    id: uuid,
    name: z.string(),
    isSystem: z.boolean(),
    permissions: z.array(permission),
  }),
})
export type SessionUser = z.infer<typeof sessionUser>

export const sessionResponse = z.object({
  token: z.string(),
  expiresAt: z.iso.datetime(),
  user: sessionUser,
})
export type SessionResponse = z.infer<typeof sessionResponse>

/**
 * مستخدمو شاشة الدخول السريع: الكاشير وأمين المخزن يدخلون بـ PIN،
 * فتُعرض أسماؤهم كبطاقات قبل إدخال الرمز (01 §5 · الدخول).
 */
export const pinUser = z.object({
  id: uuid,
  fullName: z.string(),
  roleName: z.string(),
})
export type PinUser = z.infer<typeof pinUser>
