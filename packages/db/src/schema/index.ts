/**
 * مخطط Drizzle الكامل — 65 جدولاً بنفس تقسيم `docs/02-database.md §2`.
 * مطابق حرفياً لـ `docs/falak_pos_schema.sql`؛ اختبار `tests/schema-parity.test.ts`
 * يقارن الاثنين عموداً بعمود بعد كل ترحيل ويفشل عند أي فرق.
 */
export * from './columns.js'
export * from './core.js'
export * from './money.js'
export * from './catalog.js'
export * from './inventory.js'
export * from './customers.js'
export * from './cash.js'
export * from './sales.js'
export * from './purchases.js'
export * from './system.js'
export * from './cloud.js'
export * from './relations.js'
