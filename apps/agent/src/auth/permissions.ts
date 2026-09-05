import { PERMISSIONS } from '@falak/db'

/**
 * فحص الصلاحيات في الخادم — **القاعدة 6 في `CLAUDE.md`**:
 * الواجهة تخفي فقط، والخادم يرفض. أي مسار بلا فحص هنا ثغرة.
 *
 * صيغة الصلاحية (`docs/01-project-and-permissions.md §6`):
 *   `module.action`          صلاحية مطلقة
 *   `module.action:limit`    صلاحية بحد رقمي (`pos.discount_line:10` = خصم حتى 10%)
 *
 * والصلاحيات **تراكمية لا استثنائية** (§6): من يملك الأوسع يملك الأضيق نصّاً،
 * فلا يحتاج الفحص أن يستنتج شيئاً — سؤال واحد: هل في القائمة؟
 */

export { PERMISSIONS }

/** يفصل الصلاحية عن حدّها الرقمي: `pos.discount_line:10` ⇒ `['pos.discount_line', 10]` */
export function splitPermission(permission: string): { name: string; limit: number | null } {
  const separator = permission.indexOf(':')
  if (separator === -1) return { name: permission, limit: null }
  const limit = Number(permission.slice(separator + 1))
  return {
    name: permission.slice(0, separator),
    limit: Number.isFinite(limit) ? limit : null,
  }
}

/**
 * هل يملك صاحب هذه القائمة الصلاحية المطلوبة؟
 *
 * المطلوب بلا حد يتحقّق فقط بالنسخة المطلقة: الكاشير الذي يملك
 * `pos.discount_line:10` **لا** يملك `pos.discount_line` بلا حد.
 */
export function can(granted: readonly string[], required: string): boolean {
  const { name, limit } = splitPermission(required)

  for (const permission of granted) {
    const held = splitPermission(permission)
    if (held.name !== name) continue

    // يملكها بلا حد ⇒ يملك كل حد
    if (held.limit === null) return true
    // مطلوبة بلا حد ولا يملك إلا محدودة ⇒ لا
    if (limit === null) continue
    // كلاهما محدود ⇒ يكفي أن يكون حدّه أوسع أو مساوياً
    if (held.limit >= limit) return true
  }

  return false
}

/**
 * أعلى حد رقمي يملكه لهذه الصلاحية، أو `Infinity` إن كان بلا حد، أو `null` إن لم يملكها.
 * يستعملها منطق الأعمال: «هل يجوز لهذا الكاشير خصم 12%؟»
 */
export function permissionLimit(granted: readonly string[], name: string): number | null {
  let best: number | null = null

  for (const permission of granted) {
    const held = splitPermission(permission)
    if (held.name !== name) continue
    if (held.limit === null) return Number.POSITIVE_INFINITY
    if (best === null || held.limit > best) best = held.limit
  }

  return best
}

/** هل يجوز له تطبيق هذه القيمة ضمن حدّ الصلاحية؟ */
export function withinLimit(granted: readonly string[], name: string, value: number): boolean {
  const limit = permissionLimit(granted, name)
  return limit !== null && value <= limit
}
