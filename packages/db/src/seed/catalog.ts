import { SeededRandom } from './random.js'
import { seedBarcode } from './ean13.js'
import data from './data/products.json' with { type: 'json' }

/**
 * توسيع بيانات الأساس إلى كتالوج كامل **حتمياً**.
 *
 * `data/products.json` يصف 30 تصنيفاً، كل تصنيف عائلات (`base × brands × sizes`).
 * ضربها يعطي أكثر من 500 تركيبة، فنأخذ أول `PRODUCT_COUNT` منها بترتيب ثابت.
 * البذرة ثابتة ⇒ نفس الأصناف بنفس الباركودات والأسعار في كل تشغيل، وهو شرط
 * لاعتماد الاختبارات عليها.
 */

/** عدد الأصناف المطلوب في البذرة (`docs/04-execution-plan.md` · المهمة 1.2) */
export const PRODUCT_COUNT = 500

/** البذرة الثابتة — تغييرها يغيّر كل الكتالوج، فلا تُغيَّر بلا سبب */
const SEED = 20260905

/** نسبة الأصناف التي تحصل على وحدة كرتونة إضافة للحبة */
const CARTON_RATIO = 0.18
/** نسبة الأصناف التي تحصل على باركود ثانٍ (عبوة مختلفة بنفس الصنف) */
const SECOND_BARCODE_RATIO = 0.06

export interface SeedUnit {
  key: string
  nameAr: string
  nameEn: string
  symbol: string
  allowFraction: boolean
}

export interface SeedCategory {
  key: string
  nameAr: string
  nameEn: string
}

export interface SeedProductUnit {
  unitKey: string
  factor: string
  isDefault: boolean
  price: string
  minPrice: string | null
}

export interface SeedProduct {
  nameAr: string
  nameEn: string | null
  sku: string
  categoryKey: string
  baseUnitKey: string
  isWeighed: boolean
  pluCode: string | null
  trackExpiry: boolean
  minStock: string
  manufacturer: string | null
  units: SeedProductUnit[]
  barcodes: { barcode: string; isPrimary: boolean; unitKey: string | null }[]
}

interface Family {
  base: string
  brands: string[]
  sizes: string[]
  unit: string
  priceMin: number
  priceMax: number
  trackExpiry?: boolean
  weighed?: boolean
}

interface CategoryData extends SeedCategory {
  families: Family[]
}

export const seedUnits: SeedUnit[] = data.units as SeedUnit[]
export const seedCategories: SeedCategory[] = (data.categories as CategoryData[]).map((c) => ({
  key: c.key,
  nameAr: c.nameAr,
  nameEn: c.nameEn,
}))

/** كل التركيبات الممكنة بترتيب ثابت: تصنيف ← عائلة ← علامة ← حجم */
function allCombinations(): {
  category: CategoryData
  family: Family
  brand: string
  size: string
}[] {
  const out: { category: CategoryData; family: Family; brand: string; size: string }[] = []
  for (const category of data.categories as CategoryData[]) {
    for (const family of category.families) {
      for (const brand of family.brands) {
        for (const size of family.sizes) {
          out.push({ category, family, brand, size })
        }
      }
    }
  }
  return out
}

/**
 * يبني الكتالوج الكامل. الترتيب والقيم كلها مشتقة من البذرة الثابتة،
 * فاستدعاؤه مرتين يعطي نتيجة متطابقة تماماً.
 */
export function buildSeedProducts(): SeedProduct[] {
  const rng = new SeededRandom(SEED)
  const combos = allCombinations()

  if (combos.length < PRODUCT_COUNT) {
    throw new Error(
      `بيانات الأساس تعطي ${combos.length} تركيبة فقط، والمطلوب ${PRODUCT_COUNT}. ` +
        'أضف عائلات أو أحجاماً في src/seed/data/products.json.'
    )
  }

  const products: SeedProduct[] = []
  let barcodeSerial = 1

  for (let i = 0; i < PRODUCT_COUNT; i++) {
    const { category, family, brand, size } = combos[i]!
    const nameAr = `${family.base} ${brand} ${size}`
    const isWeighed = family.weighed === true
    const price = rng.money(family.priceMin, family.priceMax)

    const units: SeedProductUnit[] = [
      {
        unitKey: family.unit,
        factor: '1.000',
        isDefault: true,
        price,
        // ثلث الأصناف له حد أدنى للسعر = 85% من سعر البيع (لا يُباع تحته بلا صلاحية)
        minPrice: rng.chance(0.33) ? (Number(price) * 0.85).toFixed(2) : null,
      },
    ]

    // كرتونة إضافية للأصناف غير الموزونة: عامل 12 أو 24 وسعر بخصم جملة
    if (!isWeighed && family.unit === 'piece' && rng.chance(CARTON_RATIO)) {
      const factor = rng.pick([12, 24])
      const cartonPrice = (Number(price) * factor * 0.92).toFixed(2)
      units.push({
        unitKey: 'carton',
        factor: `${factor}.000`,
        isDefault: false,
        price: cartonPrice,
        minPrice: null,
      })
    }

    const barcodes: SeedProduct['barcodes'] = [
      { barcode: seedBarcode(i, barcodeSerial++), isPrimary: true, unitKey: null },
    ]
    // باركود ثانٍ لبعض الأصناف (عبوة أو مورّد مختلف)
    if (rng.chance(SECOND_BARCODE_RATIO)) {
      barcodes.push({
        barcode: seedBarcode(i + 1, barcodeSerial++),
        isPrimary: false,
        unitKey: null,
      })
    }
    // الصنف ذو الكرتونة يأخذ باركوداً خاصاً بالكرتونة
    const carton = units.find((u) => u.unitKey === 'carton')
    if (carton) {
      barcodes.push({
        barcode: seedBarcode(i + 2, barcodeSerial++),
        isPrimary: false,
        unitKey: 'carton',
      })
    }

    products.push({
      nameAr,
      nameEn: null,
      sku: `FLK-${String(i + 1).padStart(4, '0')}`,
      categoryKey: category.key,
      baseUnitKey: family.unit,
      isWeighed,
      // الموزون يحتاج كود ميزان (PLU) — أربع خانات تبدأ من 1000
      pluCode: isWeighed ? String(1000 + i) : null,
      trackExpiry: family.trackExpiry === true,
      minStock: isWeighed ? '5.000' : String(rng.int(0, 24)) + '.000',
      manufacturer: brand,
      units,
      barcodes,
    })
  }

  return products
}
