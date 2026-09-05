/**
 * تحويل الوحدات.
 *
 * القاعدة 3 في CLAUDE.md وdocs/02-database.md §3.1:
 * **حركات المخزون تُخزَّن بالوحدة الأساسية دائماً** (`qty_base = qty × factor`)،
 * وأسطر الفاتورة تبقى بالوحدة المختارة (كرتونة، شريط، كيلو).
 *
 * `factor` = كم وحدة أساسية داخل الوحدة المختارة (`product_units.factor`, numeric(14,3)).
 */
import { quantity } from '@falak/contracts'
import { CORE_ERROR, CoreError, coreMessages } from './errors.js'
import { type DecimalLike, QTY_DECIMALS, roundMoney, toDecimal } from './money.js'
import type { Decimal } from 'decimal.js'

/**
 * يتحقق أن الكمية نص بصيغة `numeric(14,3)` كما في
 * `packages/contracts/src/primitives.ts` — مصدر واحد للصيغة، بلا تكرار regex.
 */
export function assertQuantity(value: string, field: string): Decimal {
  const parsed = quantity.safeParse(value)
  if (!parsed.success) {
    throw new CoreError(CORE_ERROR.INVALID_NUMBER, coreMessages.invalidNumber(field, value), field)
  }
  return toDecimal(parsed.data, field)
}

/** يتحقق أن معامل التحويل كمية صالحة **أكبر من صفر** (وإلا استحال القسمة عليه). */
export function assertFactor(factor: string): Decimal {
  const parsed = quantity.safeParse(factor)
  if (!parsed.success) {
    throw new CoreError(CORE_ERROR.INVALID_FACTOR, coreMessages.invalidFactor(factor), 'factor')
  }
  const value = toDecimal(parsed.data, 'factor')
  if (!value.isPositive() || value.isZero()) {
    throw new CoreError(CORE_ERROR.INVALID_FACTOR, coreMessages.invalidFactor(factor), 'factor')
  }
  return value
}

/** بدقّة كاملة، بلا تقريب — للاستعمال داخل الحزمة قبل التقريب النهائي. */
export function toBaseQtyDecimal(qty: DecimalLike, factor: string): Decimal {
  const q = typeof qty === 'string' ? assertQuantity(qty, 'qty') : toDecimal(qty, 'qty')
  return q.times(assertFactor(factor))
}

/** `qty × factor` — الكمية بالوحدة الأساسية كما تُخزَّن في `stock_movements`. */
export function toBaseQty(qty: string, factor: string): string {
  return roundMoney(toBaseQtyDecimal(qty, factor), QTY_DECIMALS)
}

/** العكس: `qty_base ÷ factor` — لعرض رصيد الوحدة الأساسية بوحدة البيع المختارة. */
export function fromBaseQty(qtyBase: string, factor: string): string {
  const base = assertQuantity(qtyBase, 'qtyBase')
  return roundMoney(base.div(assertFactor(factor)), QTY_DECIMALS)
}
