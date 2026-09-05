import { describe, expect, it } from 'vitest'
import { calcInvoice } from '../invoice.js'
import { calcLine, calcLineDecimal } from '../line.js'
import { TAX_MODE } from '../tax.js'
import { CORE_ERROR, CoreError } from '../errors.js'
import type { Currency } from '../money.js'

/**
 * حساب السطر والفاتورة. المرجع: ADR-002 و`docs/02-database.md §5.4`.
 * القاعدة الحاكمة: **الجمع قبل التقريب**، وفروق التقريب تُوزَّع فلا يضيع قرش.
 */

const ILS: Currency = { code: 'ILS', decimals: 2, symbol: '₪' }
/** الدينار الأردني بثلاث منازل — الحالة التي تكشف أي تقريب مثبّت على رقمين */
const JOD: Currency = { code: 'JOD', decimals: 3, symbol: 'د.أ' }

describe('calcLine — حساب السطر', () => {
  it('كمية × سعر بلا خصم ولا ضريبة', () => {
    const line = calcLine({ qty: '2.000', unitPrice: '6.50', taxRate: '0' }, ILS)
    expect(line.gross).toBe('13.00')
    expect(line.discountAmount).toBe('0.00')
    expect(line.taxAmount).toBe('0.00')
    expect(line.lineTotal).toBe('13.00')
  })

  it('خصم مبلغ يُطرح قبل الضريبة', () => {
    const line = calcLine(
      {
        qty: '10.000',
        unitPrice: '10.00',
        discount: { kind: 'amount', value: '20.00' },
        taxRate: '0',
      },
      ILS
    )
    expect(line.gross).toBe('100.00')
    expect(line.discountAmount).toBe('20.00')
    expect(line.lineTotal).toBe('80.00')
  })

  it('خصم نسبة يُحسب من إجمالي السطر', () => {
    const line = calcLine(
      {
        qty: '4.000',
        unitPrice: '25.00',
        discount: { kind: 'percent', value: '10.000' },
        taxRate: '0',
      },
      ILS
    )
    expect(line.discountAmount).toBe('10.00')
    expect(line.lineTotal).toBe('90.00')
  })

  it('ضريبة شاملة: 116 بنسبة 16% ⇒ صافي 100 وضريبة 16', () => {
    const line = calcLine(
      { qty: '1.000', unitPrice: '116.00', taxRate: '16.000', taxMode: TAX_MODE.INCLUSIVE },
      ILS
    )
    expect(line.lineTotal).toBe('116.00')
    expect(line.net).toBe('100.00')
    expect(line.taxAmount).toBe('16.00')
  })

  it('ضريبة مضافة على نفس الصافي تعطي نفس الضريبة (تكافؤ الوضعين)', () => {
    const inclusive = calcLine(
      { qty: '1.000', unitPrice: '116.00', taxRate: '16.000', taxMode: TAX_MODE.INCLUSIVE },
      ILS
    )
    const exclusive = calcLine(
      { qty: '1.000', unitPrice: '100.00', taxRate: '16.000', taxMode: TAX_MODE.EXCLUSIVE },
      ILS
    )
    expect(exclusive.net).toBe(inclusive.net)
    expect(exclusive.taxAmount).toBe(inclusive.taxAmount)
    expect(exclusive.lineTotal).toBe(inclusive.lineTotal)
  })

  it('ضريبة صفر لا تنتج NaN ولا قسمة على صفر', () => {
    const line = calcLine({ qty: '3.000', unitPrice: '7.33', taxRate: '0' }, ILS)
    expect(line.taxAmount).toBe('0.00')
    expect(line.net).toBe('21.99')
    expect(line.lineTotal).toBe('21.99')
  })

  it('كمية صفر وسعر صفر يعطيان أصفاراً لا أخطاء', () => {
    expect(calcLine({ qty: '0.000', unitPrice: '9.99', taxRate: '0' }, ILS).lineTotal).toBe('0.00')
    expect(calcLine({ qty: '5.000', unitPrice: '0.00', taxRate: '0' }, ILS).lineTotal).toBe('0.00')
  })

  it('خصم أكبر من قيمة السطر يُرفض ولا يُقصّ صامتاً', () => {
    expect(() =>
      calcLineDecimal({
        qty: '2.000',
        unitPrice: '10.00',
        discount: { kind: 'amount', value: '25.00' },
      })
    ).toThrowError(CoreError)

    try {
      calcLineDecimal({
        qty: '2.000',
        unitPrice: '10.00',
        discount: { kind: 'amount', value: '25.00' },
      })
      expect.unreachable('كان يجب أن يُرفض الخصم')
    } catch (error) {
      expect((error as CoreError).code).toBe(CORE_ERROR.LINE_DISCOUNT_TOO_LARGE)
    }
  })

  it('كمية أو سعر سالب يُرفض', () => {
    expect(() => calcLineDecimal({ qty: '-1.000', unitPrice: '10.00' })).toThrowError(CoreError)
    expect(() => calcLineDecimal({ qty: '1.000', unitPrice: '-10.00' })).toThrowError(CoreError)
  })

  it('كمية موزونة بثلاث منازل تُحسب بدقّة', () => {
    const line = calcLine({ qty: '1.235', unitPrice: '78.50', taxRate: '0' }, ILS)
    // 1.235 × 78.50 = 96.9475 ⇒ 96.95
    expect(line.lineTotal).toBe('96.95')
  })
})

describe('calcInvoice — الجمع قبل التقريب', () => {
  it('100 سطر موزون (1.235 كغ × 78.50) لا يتراكم فيها خطأ تقريب', () => {
    const lines = Array.from({ length: 100 }, () => ({
      qty: '1.235',
      unitPrice: '78.50',
      taxRate: '0',
    }))
    const invoice = calcInvoice({ lines, currency: ILS })

    // الحساب الدقيق: 100 × 96.9475 = 9694.75 بالضبط
    expect(invoice.total).toBe('9694.75')

    // لو قُرّب كل سطر على حدة (96.95) لأعطى 9695.00 — فرق 25 أغورة يظهر كعجز صندوق
    const naive = (96.95 * 100).toFixed(2)
    expect(invoice.total).not.toBe(naive)
  })

  it('مجموع الأسطر المقرَّبة يساوي الإجمالي بالضبط (لا قرش ضائع)', () => {
    const lines = Array.from({ length: 37 }, (_, i) => ({
      qty: '0.333',
      unitPrice: (3.33 + i * 0.07).toFixed(2),
      taxRate: '16.000',
    }))
    const invoice = calcInvoice({ lines, currency: ILS })

    const sumOfLines = invoice.lines.reduce((acc, l) => acc + Number(l.lineTotal), 0)
    expect(sumOfLines.toFixed(2)).toBe(invoice.total)
  })

  it('الصافي + الضريبة = الإجمالي', () => {
    const invoice = calcInvoice({
      lines: [
        { qty: '3.000', unitPrice: '11.60', taxRate: '16.000' },
        { qty: '1.500', unitPrice: '43.75', taxRate: '16.000' },
        { qty: '7.000', unitPrice: '2.90', taxRate: '16.000' },
      ],
      currency: ILS,
    })
    expect((Number(invoice.netTotal) + Number(invoice.taxTotal)).toFixed(2)).toBe(invoice.total)
  })

  it('خصم الفاتورة يُوزَّع تناسبياً ويُحسب قبل الضريبة', () => {
    const withoutDiscount = calcInvoice({
      lines: [
        { qty: '1.000', unitPrice: '100.00', taxRate: '16.000' },
        { qty: '1.000', unitPrice: '300.00', taxRate: '16.000' },
      ],
      currency: ILS,
    })
    const withDiscount = calcInvoice({
      lines: [
        { qty: '1.000', unitPrice: '100.00', taxRate: '16.000' },
        { qty: '1.000', unitPrice: '300.00', taxRate: '16.000' },
      ],
      discount: { kind: 'amount', value: '40.00' },
      currency: ILS,
    })

    expect(withoutDiscount.total).toBe('400.00')
    expect(withDiscount.total).toBe('360.00')
    expect(withDiscount.discountTotal).toBe('40.00')

    // الوعاء انخفض ⇒ الضريبة انخفضت معه (لم تُحسب على مبلغ لم يدفعه الزبون)
    expect(Number(withDiscount.taxTotal)).toBeLessThan(Number(withoutDiscount.taxTotal))

    // التوزيع تناسبي: السطر الثاني يحمل ثلاثة أرباع الخصم
    const sumOfLines = withDiscount.lines.reduce((acc, l) => acc + Number(l.lineTotal), 0)
    expect(sumOfLines.toFixed(2)).toBe('360.00')
    expect(withDiscount.lines[0]!.lineTotal).toBe('90.00')
    expect(withDiscount.lines[1]!.lineTotal).toBe('270.00')
  })

  it('خصم فاتورة بنسبة يعمل كخصم مبلغ مكافئ', () => {
    const byPercent = calcInvoice({
      lines: [{ qty: '1.000', unitPrice: '200.00', taxRate: '0' }],
      discount: { kind: 'percent', value: '25.000' },
      currency: ILS,
    })
    expect(byPercent.discountTotal).toBe('50.00')
    expect(byPercent.total).toBe('150.00')
  })

  it('خصم فاتورة أكبر من الإجمالي يُرفض', () => {
    expect(() =>
      calcInvoice({
        lines: [{ qty: '1.000', unitPrice: '50.00', taxRate: '0' }],
        discount: { kind: 'amount', value: '80.00' },
        currency: ILS,
      })
    ).toThrowError(CoreError)
  })

  it('فاتورة بلا أسطر تُرفض', () => {
    expect(() => calcInvoice({ lines: [], currency: ILS })).toThrowError(CoreError)
  })

  it('الدينار الأردني يُقرَّب بثلاث منازل لا برقمين', () => {
    const invoice = calcInvoice({
      lines: [{ qty: '3.000', unitPrice: '2.3335', taxRate: '0' }],
      currency: JOD,
    })
    // 3 × 2.3335 = 7.0005 ⇒ 7.001 بثلاث منازل (وليس 7.00)
    expect(invoice.total).toBe('7.001')
    expect(invoice.total.split('.')[1]).toHaveLength(3)
  })

  it('يحافظ على ترتيب الأسطر كما دخلت', () => {
    const invoice = calcInvoice({
      lines: [
        { qty: '1.000', unitPrice: '1.00', taxRate: '0' },
        { qty: '1.000', unitPrice: '2.00', taxRate: '0' },
        { qty: '1.000', unitPrice: '3.00', taxRate: '0' },
      ],
      currency: ILS,
    })
    expect(invoice.lines.map((l) => l.lineTotal)).toEqual(['1.00', '2.00', '3.00'])
  })
})
