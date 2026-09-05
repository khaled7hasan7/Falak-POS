/**
 * مصفوفة الصلاحيات — **المصدر الوحيد** لأسماء الصلاحيات ولما يملكه كل دور نظام.
 * منقولة صفاً صفاً من `docs/01-project-and-permissions.md §6`.
 *
 * يستوردها `src/scripts/seed.ts` لبذر الأدوار، وسيستوردها `apps/agent` مرجعاً
 * لفحص الصلاحيات في الخادم (القاعدة 6 في `CLAUDE.md`: الفحص في الخادم دائماً).
 * لا تُكتب أي صلاحية كنص حرفي خارج هذا الملف (القاعدة 7.2: لا قيم سحرية).
 *
 * ثلاث قواعد تحكم الترجمة من الجدول إلى الكود:
 * 1. **الحدود الرقمية** تُلحق بالصلاحية بنقطتين: `pos.discount_line:10`.
 * 2. **الصلاحيات الإضافية (additive):** الصلاحية الأضيق نصّ مستقل، والدور الذي
 *    يملك الأوسع يُمنح الأضيق أيضاً، فيبقى فحص الخادم `has(perm)` بلا منطق استنتاج.
 * 3. **الخلايا ذات الملاحظة بين قوسين** في الجدول تُترجم إلى صلاحية أضيق مستقلة
 *    (موثّقة أدناه بتعليق `اجتهاد:`)، لا إلى استثناء مخبّأ في الكود.
 */

/** حد خصم السطر للكاشير بلا موافقة مدير (%) */
export const DISCOUNT_LINE_LIMIT_PERCENT = 10

/** حد خصم الفاتورة للكاشير بلا موافقة مدير (%) */
export const DISCOUNT_INVOICE_LIMIT_PERCENT = 5

export const PERMISSIONS = {
  // --- شاشة الكاشير ---
  POS_SELL: 'pos.sell',
  POS_HOLD: 'pos.hold',
  /** خصم سطر حتى الحد بلا موافقة */
  POS_DISCOUNT_LINE_LIMITED: `pos.discount_line:${DISCOUNT_LINE_LIMIT_PERCENT}`,
  /** خصم سطر بلا حد */
  POS_DISCOUNT_LINE: 'pos.discount_line',
  POS_DISCOUNT_INVOICE_LIMITED: `pos.discount_invoice:${DISCOUNT_INVOICE_LIMIT_PERCENT}`,
  POS_DISCOUNT_INVOICE: 'pos.discount_invoice',
  POS_PRICE_OVERRIDE: 'pos.price_override',
  POS_BELOW_MIN_PRICE: 'pos.below_min_price',
  POS_REMOVE_LINE: 'pos.remove_line',
  POS_VOID_SALE: 'pos.void_sale',
  POS_VOID_SALE_ANY: 'pos.void_sale_any',
  POS_RETURN: 'pos.return',
  POS_RETURN_WITHOUT_INVOICE: 'pos.return_without_invoice',
  POS_SELL_ON_CREDIT: 'pos.sell_on_credit',
  POS_EXCEED_CREDIT_LIMIT: 'pos.exceed_credit_limit',
  POS_OPEN_DRAWER: 'pos.open_drawer',
  POS_REPRINT: 'pos.reprint',
  POS_CHANGE_PRICE_LIST: 'pos.change_price_list',

  // --- الورديات والصندوق ---
  SHIFTS_OPEN: 'shifts.open',
  SHIFTS_CLOSE: 'shifts.close',
  SHIFTS_CLOSE_ANY: 'shifts.close_any',
  SHIFTS_VIEW_EXPECTED: 'shifts.view_expected',
  CASH_DEPOSIT: 'cash.deposit',
  CASH_WITHDRAW: 'cash.withdraw',
  EXPENSES_CREATE: 'expenses.create',
  EXPENSES_APPROVE: 'expenses.approve',

  // --- الأصناف ---
  PRODUCTS_VIEW: 'products.view',
  PRODUCTS_CREATE: 'products.create',
  PRODUCTS_EDIT: 'products.edit',
  PRODUCTS_EDIT_PRICE: 'products.edit_price',
  PRODUCTS_VIEW_COST: 'products.view_cost',
  PRODUCTS_DELETE: 'products.delete',
  PRODUCTS_IMPORT: 'products.import',
  PRODUCTS_PRINT_LABELS: 'products.print_labels',

  // --- المخزون ---
  /**
   * عرض أرصدة المخزون. خلية الكاشير في الجدول «✓ (رصيد فقط)» تتحقق تلقائياً:
   * الكاشير يملك هذه ولا يملك `products.view_cost`، فيرى الكمية بلا تكلفة ولا تقييم.
   */
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_ADJUST: 'inventory.adjust',
  INVENTORY_TRANSFER: 'inventory.transfer',
  INVENTORY_STOCKTAKE: 'inventory.stocktake',
  INVENTORY_STOCKTAKE_APPROVE: 'inventory.stocktake_approve',
  INVENTORY_BREAKDOWN: 'inventory.breakdown',

  // --- المشتريات والموردون ---
  PURCHASES_CREATE: 'purchases.create',
  PURCHASES_RECEIVE: 'purchases.receive',
  PURCHASES_RETURN: 'purchases.return',
  PURCHASES_PAY: 'purchases.pay',
  /** اجتهاد: خلية أمين المخزن «✓ (عرض)» في صف `suppliers.manage` */
  SUPPLIERS_VIEW: 'suppliers.view',
  SUPPLIERS_MANAGE: 'suppliers.manage',

  // --- العملاء ---
  CUSTOMERS_VIEW: 'customers.view',
  /** اجتهاد: خلية الكاشير «✓ (إضافة فقط)» في صف `customers.manage` */
  CUSTOMERS_CREATE: 'customers.create',
  CUSTOMERS_MANAGE: 'customers.manage',
  CUSTOMERS_SET_CREDIT_LIMIT: 'customers.set_credit_limit',
  CUSTOMERS_RECEIVE_PAYMENT: 'customers.receive_payment',
  CUSTOMERS_STATEMENT: 'customers.statement',
  CUSTOMERS_ADJUST_BALANCE: 'customers.adjust_balance',

  PROMOTIONS_MANAGE: 'promotions.manage',

  // --- الصيدلية: صف `pharmacy.*` مفصّلاً (اجتهاد، انظر أسفل الملف) ---
  PHARMACY_PRESCRIPTIONS: 'pharmacy.prescriptions',
  PHARMACY_INSURANCE: 'pharmacy.insurance',
  PHARMACY_CLAIMS: 'pharmacy.claims',

  // --- التقارير ---
  REPORTS_SALES: 'reports.sales',
  REPORTS_PROFIT: 'reports.profit',
  REPORTS_INVENTORY: 'reports.inventory',
  REPORTS_DEBTS: 'reports.debts',
  REPORTS_SHIFTS: 'reports.shifts',
  REPORTS_EXPORT: 'reports.export',

  // --- المستخدمون والإعدادات ---
  USERS_MANAGE: 'users.manage',
  /** اجتهاد: خلية المدير «✓ (لا يعدّل owner)» — المالك وحده يملك هذه */
  USERS_MANAGE_OWNER: 'users.manage_owner',
  SETTINGS_GENERAL: 'settings.general',
  SETTINGS_MODULES: 'settings.modules',
  SETTINGS_CURRENCY_RATES: 'settings.currency_rates',
  SETTINGS_TAX: 'settings.tax',
  SETTINGS_BACKUP: 'settings.backup',
  SETTINGS_LICENSE: 'settings.license',

  // --- السجل واللوحة ---
  AUDIT_VIEW: 'audit.view',
  /** اجتهاد: خلية المدير «✓ (فرعه)» — من لا يملك هذه يرى سجل فرعه فقط */
  AUDIT_VIEW_ALL_BRANCHES: 'audit.view_all_branches',
  MOBILE_DASHBOARD: 'mobile.dashboard',
} as const

export type PermissionKey = keyof typeof PERMISSIONS
export type PermissionValue = (typeof PERMISSIONS)[PermissionKey]

const P = PERMISSIONS

/** أسماء أدوار النظام الخمسة (`docs/01-project-and-permissions.md §5`) */
export const SYSTEM_ROLES = ['owner', 'manager', 'cashier', 'stock_keeper', 'accountant'] as const
export type SystemRoleName = (typeof SYSTEM_ROLES)[number]

/** الاسم العربي المعروض لكل دور نظام */
export const SYSTEM_ROLE_LABELS_AR: Record<SystemRoleName, string> = {
  owner: 'المالك',
  manager: 'المدير',
  cashier: 'الكاشير',
  stock_keeper: 'أمين المخزن',
  accountant: 'المحاسب',
}

/** المالك: كل ✓ في العمود الأول من المصفوفة — أي كل الصلاحيات بلا استثناء */
const OWNER: PermissionValue[] = Object.values(P)

const MANAGER: PermissionValue[] = [
  P.POS_SELL,
  P.POS_HOLD,
  P.POS_DISCOUNT_LINE_LIMITED,
  P.POS_DISCOUNT_LINE,
  P.POS_DISCOUNT_INVOICE_LIMITED,
  P.POS_DISCOUNT_INVOICE,
  P.POS_PRICE_OVERRIDE,
  P.POS_REMOVE_LINE,
  P.POS_VOID_SALE,
  P.POS_RETURN,
  P.POS_RETURN_WITHOUT_INVOICE,
  P.POS_SELL_ON_CREDIT,
  P.POS_EXCEED_CREDIT_LIMIT,
  P.POS_OPEN_DRAWER,
  P.POS_REPRINT,
  P.POS_CHANGE_PRICE_LIST,
  P.SHIFTS_OPEN,
  P.SHIFTS_CLOSE,
  P.SHIFTS_CLOSE_ANY,
  P.SHIFTS_VIEW_EXPECTED,
  P.CASH_DEPOSIT,
  P.CASH_WITHDRAW,
  P.EXPENSES_CREATE,
  P.PRODUCTS_VIEW,
  P.PRODUCTS_CREATE,
  P.PRODUCTS_EDIT,
  P.PRODUCTS_EDIT_PRICE,
  P.PRODUCTS_VIEW_COST,
  P.PRODUCTS_DELETE,
  P.PRODUCTS_IMPORT,
  P.PRODUCTS_PRINT_LABELS,
  P.INVENTORY_VIEW,
  P.INVENTORY_ADJUST,
  P.INVENTORY_TRANSFER,
  P.INVENTORY_STOCKTAKE,
  P.INVENTORY_STOCKTAKE_APPROVE,
  P.INVENTORY_BREAKDOWN,
  P.PURCHASES_CREATE,
  P.PURCHASES_RECEIVE,
  P.PURCHASES_RETURN,
  P.PURCHASES_PAY,
  P.SUPPLIERS_VIEW,
  P.SUPPLIERS_MANAGE,
  P.CUSTOMERS_VIEW,
  P.CUSTOMERS_CREATE,
  P.CUSTOMERS_MANAGE,
  P.CUSTOMERS_SET_CREDIT_LIMIT,
  P.CUSTOMERS_RECEIVE_PAYMENT,
  P.CUSTOMERS_STATEMENT,
  P.PROMOTIONS_MANAGE,
  P.PHARMACY_PRESCRIPTIONS,
  P.PHARMACY_INSURANCE,
  P.PHARMACY_CLAIMS,
  P.REPORTS_SALES,
  P.REPORTS_INVENTORY,
  P.REPORTS_DEBTS,
  P.REPORTS_SHIFTS,
  P.REPORTS_EXPORT,
  P.USERS_MANAGE,
  P.SETTINGS_GENERAL,
  P.SETTINGS_CURRENCY_RATES,
  P.AUDIT_VIEW,
  P.MOBILE_DASHBOARD,
]

const CASHIER: PermissionValue[] = [
  P.POS_SELL,
  P.POS_HOLD,
  P.POS_DISCOUNT_LINE_LIMITED,
  P.POS_DISCOUNT_INVOICE_LIMITED,
  P.POS_REMOVE_LINE,
  P.POS_RETURN,
  P.POS_SELL_ON_CREDIT,
  P.POS_REPRINT,
  P.SHIFTS_OPEN,
  P.SHIFTS_CLOSE,
  P.PRODUCTS_VIEW,
  P.INVENTORY_VIEW,
  P.CUSTOMERS_VIEW,
  P.CUSTOMERS_CREATE,
  P.CUSTOMERS_RECEIVE_PAYMENT,
  P.CUSTOMERS_STATEMENT,
  P.PHARMACY_PRESCRIPTIONS,
]

const STOCK_KEEPER: PermissionValue[] = [
  P.PRODUCTS_VIEW,
  P.PRODUCTS_CREATE,
  P.PRODUCTS_EDIT,
  P.PRODUCTS_IMPORT,
  P.PRODUCTS_PRINT_LABELS,
  P.INVENTORY_VIEW,
  P.INVENTORY_ADJUST,
  P.INVENTORY_TRANSFER,
  P.INVENTORY_STOCKTAKE,
  P.INVENTORY_BREAKDOWN,
  P.PURCHASES_CREATE,
  P.PURCHASES_RECEIVE,
  P.SUPPLIERS_VIEW,
  P.REPORTS_INVENTORY,
]

const ACCOUNTANT: PermissionValue[] = [
  P.POS_REPRINT,
  P.SHIFTS_VIEW_EXPECTED,
  P.EXPENSES_CREATE,
  P.PRODUCTS_VIEW,
  P.PRODUCTS_VIEW_COST,
  P.INVENTORY_VIEW,
  P.PURCHASES_PAY,
  P.SUPPLIERS_VIEW,
  P.SUPPLIERS_MANAGE,
  P.CUSTOMERS_VIEW,
  P.CUSTOMERS_RECEIVE_PAYMENT,
  P.CUSTOMERS_STATEMENT,
  P.PHARMACY_CLAIMS,
  P.REPORTS_SALES,
  P.REPORTS_PROFIT,
  P.REPORTS_INVENTORY,
  P.REPORTS_DEBTS,
  P.REPORTS_SHIFTS,
  P.REPORTS_EXPORT,
  P.SETTINGS_CURRENCY_RATES,
  P.AUDIT_VIEW,
  P.AUDIT_VIEW_ALL_BRANCHES,
]

/** صلاحيات كل دور نظام — تُبذر في `roles.permissions` بـ `is_system = true` */
export const ROLE_PERMISSIONS: Record<SystemRoleName, readonly PermissionValue[]> = {
  owner: OWNER,
  manager: MANAGER,
  cashier: CASHIER,
  stock_keeper: STOCK_KEEPER,
  accountant: ACCOUNTANT,
}
