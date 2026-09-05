/**
 * @falak/contracts — المصدر الوحيد لأشكال البيانات بين الواجهة والوكيل.
 *
 * القاعدة 7.2 في CLAUDE.md: كل شكل بيانات يعبر الـ API يُعرَّف zod هنا
 * ويُشتق النوع منه (`z.infer`) — لا تُكتب واجهة TypeScript يدوياً في أي مكان آخر.
 *
 * نطاق هذه المرحلة (M1): المصادقة والجلسة، الكتالوج، الاستيراد.
 * لا تُضاف هنا أنواع لمراحل لاحقة استباقياً (CLAUDE.md §6).
 */
export * from './primitives.js'
export * from './auth.js'
export * from './catalog.js'
export * from './import.js'
