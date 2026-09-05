import { describe, expect, it } from 'vitest'
import { CORE_ERROR, CoreError } from '../errors.js'
import {
  add,
  allocateRounded,
  assertDecimals,
  type Currency,
  div,
  formatMoney,
  formatNumber,
  mul,
  parsePercentFactor,
  roundMoney,
  sub,
  sum,
  toDecimal,
  toDisplayNumber,
  toNonNegativeDecimal,
  zeroAmount,
} from '../money.js'

const ILS: Currency = { code: 'ILS', decimals: 2, symbol: '₪' }
const JOD: Currency = { code: 'JOD', decimals: 3, symbol: 'د.أ' }

/** يلتقط الخطأ ويعيده مصنَّفاً، فيُفحص الرمز والرسالة معاً. */
function catchCoreError(fn: () => unknown): CoreError {
  try {
    fn()
  } catch (error) {
    if (error instanceof CoreError) return error
    throw error
  }
  throw new Error('كان متوقعاً أن ترمي الدالة CoreError ولم ترمِ')
}

describe('toDecimal — التحقق من صيغة المدخل', () => {
  it('يقبل النصوص السليمة بإشارة وبكسر', () => {
    expect(toDecimal('1248.50').toString()).toBe('1248.5')
    expect(toDecimal('-3').toString()).toBe('-3')
    expect(toDecimal('0').toString()).toBe('0')
  })

  it('يرفض ما ليس رقماً برسالة عربية تذكر الحقل والقيمة', () => {
    const error = catchCoreError(() => toDecimal('abc', 'سعر الوحدة'))
    expect(error.code).toBe(CORE_ERROR.INVALID_NUMBER)
    expect(error.field).toBe('سعر الوحدة')
    expect(error.message).toContain('سعر الوحدة')
    expect(error.message).toContain('abc')
  })

  it.each([
    ['نص فارغ', ''],
    ['صيغة أُسّية', '1e5'],
    ['فاصلة آلاف', '1,248.50'],
    ['نقطتان', '1.2.3'],
    ['مسافة', ' 12 '],
    ['NaN نصاً', 'NaN'],
    ['علامة موجب', '+5'],
  ])('يرفض %s', (_label, value) => {
    expect(() => toDecimal(value)).toThrow(CoreError)
  })

  it('يرفض الأرقام الأصلية لأن المال نصوص لا أرقام (ADR-002 §3)', () => {
    // القيمة رقم عمداً: النوع يمنعها عند الترجمة، والفحص يمنعها وقت التشغيل.
    const asNumber = 12.5 as unknown as string
    expect(catchCoreError(() => toDecimal(asNumber)).code).toBe(CORE_ERROR.INVALID_NUMBER)
  })

  it('يرفض السالب حيث لا معنى له', () => {
    const error = catchCoreError(() => toNonNegativeDecimal('-5.00', 'مبلغ الدفعة'))
    expect(error.code).toBe(CORE_ERROR.NEGATIVE_NOT_ALLOWED)
    expect(error.message).toContain('مبلغ الدفعة')
  })

  it('يقبل الصفر في الحقول غير السالبة', () => {
    expect(toNonNegativeDecimal('0', 'الكمية').isZero()).toBe(true)
  })
})

describe('roundMoney — دالة التقريب الوحيدة', () => {
  it('يقرّب بمنزلتين للشيكل (نصف لأعلى)', () => {
    expect(roundMoney('2.345', ILS.decimals)).toBe('2.35')
    expect(roundMoney('2.344', ILS.decimals)).toBe('2.34')
    expect(roundMoney('96.9475', ILS.decimals)).toBe('96.95')
  })

  it('يحترم ثلاث منازل للدينار الأردني (ADR-002 §4)', () => {
    expect(roundMoney('1.2345', JOD.decimals)).toBe('1.235')
    expect(roundMoney('1.2344', JOD.decimals)).toBe('1.234')
    // نفس القيمة بمنازل مختلفة تعطي نتائج مختلفة — العملة هي التي تقرر
    expect(roundMoney('10.0005', JOD.decimals)).toBe('10.001')
    expect(roundMoney('10.0005', ILS.decimals)).toBe('10.00')
  })

  it('يعيد صفراً بلا إشارة سالبة', () => {
    expect(roundMoney('-0.001', ILS.decimals)).toBe('0.00')
    expect(zeroAmount(JOD.decimals)).toBe('0.000')
  })

  it.each([7, -1, 1.5, Number.NaN])('يرفض عدد منازل غير صالح: %s', (decimals) => {
    const error = catchCoreError(() => roundMoney('1', decimals))
    expect(error.code).toBe(CORE_ERROR.INVALID_DECIMALS)
  })

  it('يقبل صفر منازل', () => {
    expect(roundMoney('2.5', 0)).toBe('3')
    expect(assertDecimals(0)).toBe(0)
  })
})

describe('الحساب بدقّة كاملة', () => {
  it('0.1 + 0.2 = 0.3 بلا خطأ عائم (سبب ADR-002)', () => {
    expect(add('0.1', '0.2').toString()).toBe('0.3')
    expect(sum(['0.1', '0.2']).equals('0.3')).toBe(true)
  })

  it('يجمع ويطرح ويضرب بلا تقريب وسيط', () => {
    expect(sub('10', '0.001').toString()).toBe('9.999')
    expect(mul('1.235', '78.50').toString()).toBe('96.9475')
    expect(sum([]).toString()).toBe('0')
  })

  it('يرفض القسمة على صفر', () => {
    expect(catchCoreError(() => div('1', '0')).code).toBe(CORE_ERROR.INVALID_NUMBER)
    expect(div('10', '4').toString()).toBe('2.5')
  })
})

describe('parsePercentFactor', () => {
  it('يحوّل النسبة إلى معامل عشري', () => {
    expect(parsePercentFactor('16.000', 'taxRate', 'نسبة الضريبة').toString()).toBe('0.16')
    expect(parsePercentFactor('0', 'taxRate', 'نسبة الضريبة').isZero()).toBe(true)
  })

  it.each(['101', '-5', 'abc', ''])('يرفض النسبة غير الصالحة: %s', (value) => {
    const error = catchCoreError(() => parsePercentFactor(value, 'taxRate', 'نسبة الضريبة'))
    expect(error.code).toBe(CORE_ERROR.INVALID_PERCENT)
  })
})

describe('allocateRounded — توزيع فروق التقريب', () => {
  it('يوزّع النقص على أكبر الباقي فيساوي المجموع الإجمالي بالضبط', () => {
    // ثلاثة أثلاث من 20.00: التقريب الساذج يعطي 20.01
    const thirds = ['6.6666666667', '6.6666666667', '6.6666666666']
    const allocated = allocateRounded(thirds, '20.00', 2)
    expect(allocated).toEqual(['6.67', '6.67', '6.66'])
    expect(roundMoney(sum(allocated), 2)).toBe('20.00')
  })

  it('يوزّع الزيادة كذلك', () => {
    const allocated = allocateRounded(['3.334', '3.333', '3.333'], '10.00', 2)
    expect(allocated).toEqual(['3.34', '3.33', '3.33'])
    expect(roundMoney(sum(allocated), 2)).toBe('10.00')
  })

  it('لا يغيّر شيئاً حين لا فرق', () => {
    expect(allocateRounded(['1.00', '2.00'], '3.00', 2)).toEqual(['1.00', '2.00'])
  })

  it('يعيد قائمة فارغة لمدخلات فارغة', () => {
    expect(allocateRounded([], '0.00', 2)).toEqual([])
  })

  it('يوزّع بثلاث منازل للدينار', () => {
    const allocated = allocateRounded(['0.3333', '0.3333', '0.3334'], '1.000', 3)
    expect(roundMoney(sum(allocated), 3)).toBe('1.000')
  })
})

describe('العرض — هنا فقط يجوز number', () => {
  it('ينسّق بفاصلة آلاف والرمز بعد الرقم (docs/03 §7)', () => {
    expect(formatMoney('1248.5', ILS)).toBe('1,248.50 ₪')
    expect(formatMoney('1248.5', { code: 'ILS', decimals: 2 })).toBe('1,248.50')
    expect(formatMoney('20.75', JOD)).toBe('20.750 د.أ')
  })

  it('ينسّق الأرقام الكبيرة والسالبة والصغيرة', () => {
    expect(formatNumber('1234567.891', 2)).toBe('1,234,567.89')
    expect(formatNumber('-1234.5', 2)).toBe('-1,234.50')
    expect(formatNumber('12', 0)).toBe('12')
    expect(formatNumber('999', 2)).toBe('999.00')
  })

  it('يحوّل إلى number بعد التقريب فقط', () => {
    expect(toDisplayNumber('1.005', 2)).toBe(1.01)
  })
})
