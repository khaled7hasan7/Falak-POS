import { describe, expect, it } from 'vitest'
import {
  barcode,
  currencyCode,
  loginRequest,
  money,
  permission,
  pinLoginRequest,
  productInput,
  quantity,
  unitInput,
} from '../index.js'

/**
 * العقود — الحارس عند حدود الـ API.
 * القاعدة 7.2: كل شكل بيانات يُعرَّف مرة واحدة هنا ويُشتق نوعه منه.
 */

const VALID_UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

describe('الأنواع الأوّلية', () => {
  it('المبلغ نص برقمين عشريين كحد أقصى (numeric(14,2) — ADR-002)', () => {
    for (const valid of ['0', '12', '1248.5', '1248.50', '-30.25']) {
      expect(money.safeParse(valid).success).toBe(true)
    }
    for (const invalid of ['1248.505', '1,248.50', '12.5.5', 'عشرة', '', '1e3']) {
      expect(money.safeParse(invalid).success, `يجب رفض ${invalid}`).toBe(false)
    }
  })

  it('المبلغ يُرفض كرقم — يعبر نصاً لئلا يفسده JSON.parse', () => {
    expect(money.safeParse(1248.5).success).toBe(false)
  })

  it('الكمية بثلاث منازل (الوزن بالغرام)', () => {
    expect(quantity.safeParse('1.235').success).toBe(true)
    expect(quantity.safeParse('1.2355').success).toBe(false)
  })

  it('الباركود أرقام فقط بين 4 و24 خانة', () => {
    expect(barcode.safeParse('6251234567890').success).toBe(true)
    expect(barcode.safeParse('123').success).toBe(false)
    expect(barcode.safeParse('62512345678A0').success).toBe(false)
  })

  it('رمز العملة ثلاثة أحرف لاتينية كبيرة', () => {
    expect(currencyCode.safeParse('ILS').success).toBe(true)
    expect(currencyCode.safeParse('ils').success).toBe(false)
    expect(currencyCode.safeParse('SHEKEL').success).toBe(false)
  })
})

describe('صيغة الصلاحية (docs/01 §6)', () => {
  it('تقبل module.action وmodule.action:limit', () => {
    expect(permission.safeParse('products.view').success).toBe(true)
    expect(permission.safeParse('pos.discount_line:10').success).toBe(true)
    expect(permission.safeParse('pos.discount_invoice:5').success).toBe(true)
  })

  it('ترفض ما ليس بهذه الصيغة', () => {
    for (const invalid of ['products', 'Products.View', 'products.view:abc', '']) {
      expect(permission.safeParse(invalid).success, `يجب رفض ${invalid}`).toBe(false)
    }
  })

  it('ترفض الأحرف البدلية — الخادم لا يفهمها فلا يجوز أن يقبلها النوع', () => {
    expect(permission.safeParse('pharmacy.*').success).toBe(false)
    expect(permission.safeParse('*.*').success).toBe(false)
  })
})

describe('طلبات الدخول', () => {
  it('كلمة المرور تحتاج اسم مستخدم وكلمة مرور غير فارغين', () => {
    expect(loginRequest.safeParse({ username: 'khaled', password: 'x' }).success).toBe(true)
    expect(loginRequest.safeParse({ username: '', password: 'x' }).success).toBe(false)
  })

  it('الـ PIN من 4 إلى 6 أرقام', () => {
    expect(pinLoginRequest.safeParse({ userId: VALID_UUID, pin: '1234' }).success).toBe(true)
    expect(pinLoginRequest.safeParse({ userId: VALID_UUID, pin: '123456' }).success).toBe(true)
    expect(pinLoginRequest.safeParse({ userId: VALID_UUID, pin: '123' }).success).toBe(false)
    expect(pinLoginRequest.safeParse({ userId: VALID_UUID, pin: '12a4' }).success).toBe(false)
    expect(pinLoginRequest.safeParse({ userId: 'not-a-uuid', pin: '1234' }).success).toBe(false)
  })
})

describe('نموذج الصنف', () => {
  const base = {
    nameAr: 'حليب طازج',
    baseUnitId: VALID_UUID,
    units: [{ unitId: VALID_UUID, factor: '1.000', isDefault: true, prices: [] }],
    barcodes: [],
  }

  it('يقبل صنفاً صالحاً بحد أدنى من الحقول', () => {
    expect(productInput.safeParse(base).success).toBe(true)
  })

  it('يرفض الاسم الفارغ برسالة عربية', () => {
    const result = productInput.safeParse({ ...base, nameAr: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]!.message).toContain('اسم الصنف')
    }
  })

  it('يفرض وحدة افتراضية واحدة بالضبط', () => {
    const none = productInput.safeParse({
      ...base,
      units: [{ unitId: VALID_UUID, factor: '1.000', isDefault: false, prices: [] }],
    })
    expect(none.success).toBe(false)

    const two = productInput.safeParse({
      ...base,
      units: [
        { unitId: VALID_UUID, factor: '1.000', isDefault: true, prices: [] },
        { unitId: VALID_UUID, factor: '24.000', isDefault: true, prices: [] },
      ],
    })
    expect(two.success).toBe(false)
  })

  it('يرفض صنفاً بلا وحدات', () => {
    expect(productInput.safeParse({ ...base, units: [] }).success).toBe(false)
  })

  it('الصنف الموزون يحتاج كود ميزان (docs/02 §5.2)', () => {
    const without = productInput.safeParse({ ...base, isWeighed: true })
    expect(without.success).toBe(false)

    const withPlu = productInput.safeParse({ ...base, isWeighed: true, pluCode: '1234' })
    expect(withPlu.success).toBe(true)
  })

  it('المعامل يجب أن يكون أكبر من صفر', () => {
    const zero = productInput.safeParse({
      ...base,
      units: [{ unitId: VALID_UUID, factor: '0.000', isDefault: true, prices: [] }],
    })
    expect(zero.success).toBe(false)
  })

  it('يطبّق القيم الافتراضية الموثّقة', () => {
    const result = productInput.parse(base)
    expect(result.productType).toBe('standard')
    expect(result.costMethod).toBe('avg')
    expect(result.isActive).toBe(true)
    expect(result.trackExpiry).toBe(false)
    expect(result.minStock).toBe('0')
  })
})

describe('نموذج الوحدة', () => {
  it('allowFraction افتراضه false — الحبة لا تقبل الكسور', () => {
    expect(unitInput.parse({ nameAr: 'حبة' }).allowFraction).toBe(false)
    expect(unitInput.parse({ nameAr: 'كيلو', allowFraction: true }).allowFraction).toBe(true)
  })

  it('الاسم مطلوب', () => {
    expect(unitInput.safeParse({ nameAr: '' }).success).toBe(false)
  })
})
