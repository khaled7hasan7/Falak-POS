import ar from './locales/ar.json' with { type: 'json' }
import en from './locales/en.json' with { type: 'json' }
import termsSupermarket from './locales/terms.supermarket.json' with { type: 'json' }
import termsPharmacy from './locales/terms.pharmacy.json' with { type: 'json' }
import termsButcher from './locales/terms.butcher.json' with { type: 'json' }
import termsProduce from './locales/terms.produce.json' with { type: 'json' }

/**
 * @falak/i18n — الترجمة ومصطلحات نوع النشاط.
 *
 * القاعدة الحاكمة (`docs/03-design-system.md §7`): **العربية أولاً (RTL)**
 * والإنجليزية ترجمة، لا العكس. ومصطلحات النشاط (`docs/01 §4`) تُدمج **فوق**
 * الأساس، فيصير «الصنف» دواءً في الصيدلية وقطعةً في الملحمة بلا شرط في الكود.
 *
 * لا مكتبة خارجية: القاموس كائن مسطّح ودالة استبدال واحدة — أبسط مما تحتاجه
 * أي مكتبة i18n، ويعمل في الوكيل والواجهة معاً.
 */

export const LOCALES = ['ar', 'en'] as const
export type Locale = (typeof LOCALES)[number]

/** اللغة الافتراضية — عربية، وهي الأصل لا الترجمة */
export const DEFAULT_LOCALE: Locale = 'ar'

/** أنواع النشاط التي لها ملف مصطلحات (`docs/01-project-and-permissions.md §4`) */
export const BUSINESS_TYPES = ['supermarket', 'pharmacy', 'butcher', 'produce', 'general'] as const
export type BusinessType = (typeof BUSINESS_TYPES)[number]

export type Dictionary = Record<string, string>

/** مفتاح التعليق داخل ملفات JSON — يُستبعد من القاموس */
const COMMENT_KEY = '$comment'

function clean(source: Record<string, string>): Dictionary {
  const out: Dictionary = {}
  for (const [key, value] of Object.entries(source)) {
    if (key !== COMMENT_KEY) out[key] = value
  }
  return out
}

const BASE: Record<Locale, Dictionary> = {
  ar: clean(ar),
  en: clean(en),
}

/** مصطلحات النشاط بالعربية. `general` بلا مصطلحات خاصة فيستعمل الأساس. */
const TERMS: Record<BusinessType, Dictionary> = {
  supermarket: clean(termsSupermarket),
  pharmacy: clean(termsPharmacy),
  butcher: clean(termsButcher),
  produce: clean(termsProduce),
  general: {},
}

export type TranslateVars = Record<string, string | number>

export interface TranslatorOptions {
  locale?: Locale
  businessType?: BusinessType
}

/** الاتجاه المناسب للغة — الجذر `<html dir>` يعتمد عليه (`docs/03 §7`) */
export function getDirection(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr'
}

/**
 * يبني قاموساً مدموجاً: الأساس ثم مصطلحات النشاط فوقه.
 * مصطلحات النشاط بالعربية فقط، فلا تُدمج على الإنجليزية.
 */
export function buildDictionary(
  locale: Locale = DEFAULT_LOCALE,
  businessType: BusinessType = 'supermarket'
): Dictionary {
  const base = BASE[locale] ?? BASE[DEFAULT_LOCALE]
  if (locale !== 'ar') return { ...base }
  return { ...base, ...TERMS[businessType] }
}

/** يستبدل `{name}` بقيمته. المتغيّر المفقود يبقى كما هو فيظهر النقص بدل أن يُخفى. */
export function interpolate(template: string, vars?: TranslateVars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match
  )
}

export type Translator = (key: string, vars?: TranslateVars) => string

/**
 * يصنع دالة الترجمة.
 *
 * **المفتاح المفقود يُعاد كما هو** ولا يُستبدل بنص فارغ ولا بالإنجليزية:
 * النقص يجب أن يظهر على الشاشة ليُصلَح، لا أن يختفي صامتاً.
 */
export function createTranslator(options: TranslatorOptions = {}): Translator {
  const dictionary = buildDictionary(options.locale, options.businessType)
  return (key, vars) => {
    const template = dictionary[key]
    return template === undefined ? key : interpolate(template, vars)
  }
}

/** مترجم افتراضي جاهز (عربي · سوبرماركت) لمن لا يحتاج تهيئة */
export const t: Translator = createTranslator()

/** مفاتيح لغة بعينها — يستخدمها اختبار التكافؤ ولوحات التطوير */
export function localeKeys(locale: Locale): string[] {
  return Object.keys(BASE[locale]).sort()
}
