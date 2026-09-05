/**
 * @falak/core — منطق الأعمال المشترك: المال، الوحدات، الضريبة، الفاتورة، الدفع.
 *
 * دوال **نقية** بلا اعتماد على قاعدة بيانات ولا شبكة ولا React (ADR-002 §الأثر)،
 * فتُختبر كل الحالات بسرعة ويستعملها الوكيل والواجهة معاً بلا تكرار (CLAUDE.md §7.2).
 *
 * القواعد الحاكمة:
 *  - كل حساب مالي بـ `decimal.js`؛ `number` للعرض النهائي فقط.
 *  - المدخلات والمخرجات المالية **نصوص** (`"1248.50"`) لا أرقام.
 *  - **دالة تقريب واحدة**: `roundMoney(value, decimals)` و`decimals` من `currencies.decimals`.
 *  - **الجمع قبل التقريب**، وفروق التقريب تُوزَّع على الأسطر فلا يضيع قرش.
 */
export * from './errors.js'
export * from './money.js'
export * from './units.js'
export * from './tax.js'
export * from './line.js'
export * from './invoice.js'
export * from './payment.js'
export * from './rounding.js'
