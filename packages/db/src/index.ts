/**
 * @falak/db — المخطط والاتصال والترحيلات.
 *
 * `docs/falak_pos_schema.sql` هو مصدر الـ DDL، و`migrations/0001_init.sql` نسخة
 * حرفية منه. مخطط Drizzle هنا مكتوب بيد الإنسان ويحرسه `schema-parity.test.ts`
 * الذي يقارنه بالقاعدة الحيّة عموداً بعمود بعد كل ترحيل.
 */
export * from './schema/index.js'
export * from './client.js'
export * from './migrator.js'

/**
 * مصفوفة الصلاحيات — المصدر الوحيد لأسمائها ولما يملكه كل دور نظام،
 * منقولة من `docs/01-project-and-permissions.md §6` ويحرس تطابقها
 * `permissions.test.ts`. يستوردها `apps/agent` لفحص الصلاحيات في الخادم
 * (القاعدة 6)، وسكربت البذرة لبذر الأدوار.
 */
export {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  SYSTEM_ROLES,
  SYSTEM_ROLE_LABELS_AR,
  DISCOUNT_LINE_LIMIT_PERCENT,
  DISCOUNT_INVOICE_LIMIT_PERCENT,
  type PermissionKey,
  type PermissionValue,
  type SystemRoleName,
} from './seed/permissions.js'
