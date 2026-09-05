import { describe, expect, it } from 'vitest'
import {
  BUSINESS_TYPES,
  DEFAULT_LOCALE,
  buildDictionary,
  createTranslator,
  getDirection,
  interpolate,
  localeKeys,
  t,
} from '../index.js'

describe('اللغة والاتجاه', () => {
  it('العربية هي الافتراضية وهي RTL (docs/03 §7)', () => {
    expect(DEFAULT_LOCALE).toBe('ar')
    expect(getDirection('ar')).toBe('rtl')
    expect(getDirection('en')).toBe('ltr')
  })
})

describe('تكافؤ المفاتيح بين اللغتين', () => {
  it('لا مفتاح في ar بلا مقابل في en والعكس', () => {
    const arabic = localeKeys('ar')
    const english = localeKeys('en')

    const missingInEnglish = arabic.filter((k) => !english.includes(k))
    const missingInArabic = english.filter((k) => !arabic.includes(k))

    expect(missingInEnglish).toEqual([])
    expect(missingInArabic).toEqual([])
  })

  it('لا قيمة فارغة في أي لغة', () => {
    for (const locale of ['ar', 'en'] as const) {
      const dictionary = buildDictionary(locale)
      const empty = Object.entries(dictionary)
        .filter(([, value]) => value.trim() === '')
        .map(([key]) => key)
      expect(empty).toEqual([])
    }
  })

  it('لا يتسرّب مفتاح التعليق $comment إلى القاموس', () => {
    for (const businessType of BUSINESS_TYPES) {
      expect(Object.keys(buildDictionary('ar', businessType))).not.toContain('$comment')
    }
  })
})

describe('دمج مصطلحات النشاط', () => {
  it('السوبرماركت: الوحدة الأساسية حبة والشاشة المخزون', () => {
    const translate = createTranslator({ businessType: 'supermarket' })
    expect(translate('term.baseUnit')).toBe('حبة')
    expect(translate('term.inventoryScreen')).toBe('المخزون')
  })

  it('الصيدلية: الصنف دواء والشاشة المستودع (docs/01 §4)', () => {
    const translate = createTranslator({ businessType: 'pharmacy' })
    expect(translate('term.item')).toBe('دواء')
    expect(translate('term.inventoryScreen')).toBe('المستودع')
  })

  it('الملحمة: الصنف قطعة والوحدة كيلو والشاشة الثلاجة', () => {
    const translate = createTranslator({ businessType: 'butcher' })
    expect(translate('term.item')).toBe('قطعة')
    expect(translate('term.baseUnit')).toBe('كيلو')
    expect(translate('term.inventoryScreen')).toBe('الثلاجة')
  })

  it('مصطلحات النشاط تغطّي الأساس ولا تحذف بقيته', () => {
    const supermarket = buildDictionary('ar', 'supermarket')
    const pharmacy = buildDictionary('ar', 'pharmacy')

    expect(supermarket['term.item']).not.toBe(pharmacy['term.item'])
    // مفاتيح الأساس موجودة في الاثنين بلا تغيير
    expect(supermarket['action.save']).toBe('احفظ')
    expect(pharmacy['action.save']).toBe('احفظ')
  })

  it('مصطلحات النشاط لا تُدمج على الإنجليزية', () => {
    const translate = createTranslator({ locale: 'en', businessType: 'pharmacy' })
    // لا ترجمة إنجليزية للمصطلح ⇒ يُعاد المفتاح كما هو
    expect(translate('term.item')).toBe('term.item')
    expect(translate('action.save')).toBe('Save')
  })
})

describe('استبدال المتغيرات', () => {
  it('يستبدل {name} بقيمته', () => {
    expect(t('product.saved', { name: 'حليب الجنيدي' })).toBe('حُفظ الصنف «حليب الجنيدي»')
  })

  it('يستبدل الأرقام كما هي', () => {
    expect(t('product.count', { count: 500 })).toBe('500 صنف')
  })

  it('يستبدل عدة متغيرات في النص نفسه', () => {
    const translate = createTranslator({ locale: 'en' })
    expect(translate('table.page', { page: 2, total: 10 })).toBe('Page 2 of 10')
  })

  it('المتغيّر المفقود يبقى ظاهراً بدل أن يُخفى', () => {
    expect(interpolate('مرحباً {name} في {place}', { name: 'خالد' })).toBe('مرحباً خالد في {place}')
  })

  it('نص بلا متغيرات يمرّ كما هو', () => {
    expect(interpolate('احفظ')).toBe('احفظ')
    expect(interpolate('احفظ', {})).toBe('احفظ')
  })
})

describe('المفتاح المفقود', () => {
  it('يُعاد كما هو فيظهر النقص على الشاشة', () => {
    expect(t('key.that.does.not.exist')).toBe('key.that.does.not.exist')
  })

  it('لا يسقط إلى الإنجليزية ولا يعيد نصاً فارغاً', () => {
    const translate = createTranslator({ locale: 'ar' })
    const result = translate('another.missing.key')
    expect(result).not.toBe('')
    expect(result).toBe('another.missing.key')
  })
})

describe('رسائل الخطأ تقول ما العمل (docs/03 §7)', () => {
  it('رسائل المصادقة والباركود ترشد المستخدم لخطوة تالية', () => {
    for (const key of ['auth.invalidPin', 'barcode.duplicate', 'error.forbidden']) {
      const message = t(key)
      expect(message.length).toBeGreaterThan(20)
      expect(message).not.toBe(key)
    }
  })
})
