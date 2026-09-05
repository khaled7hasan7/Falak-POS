import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'
import { buildSeedProducts, seedCategories, seedUnits } from '../seed/catalog.js'

/**
 * يولّد ملف Excel من نفس بيانات البذرة، ليستخدمه `apps/agent` عيّنةً لاختبار
 * الاستيراد (المهمة 1.4)، وليجرّبه المستخدم من شاشة الاستيراد.
 *
 * الملف حتمي مثل البذرة، ويُودَع في git. أعِد تشغيل السكربت بعد أي تغيير في
 * `src/seed/data/products.json` أو في مولّد الكتالوج.
 *
 * أسماء الأعمدة عربية عمداً — هذا ما سيصل من العميل فعلاً، وهو ما يجب أن
 * يكتشفه المستورد تلقائياً.
 */

const OUTPUT_PATH = resolve(fileURLToPath(new URL('../seed/data/products.xlsx', import.meta.url)))

/** عدد الصفوف الخاطئة عمداً في نهاية الملف — لاختبار تقرير أخطاء الصفوف */
const BROKEN_ROWS = [
  {
    'اسم الصنف': '',
    الباركود: '6250000000009',
    التصنيف: 'ألبان وأجبان',
    الوحدة: 'حبة',
    السعر: '10.00',
    'الحد الأدنى': '5',
    'اسم المورد': 'اختبار',
  },
  {
    'اسم الصنف': 'صنف بسعر غير رقمي',
    الباركود: '6250000000016',
    التصنيف: 'مخبوزات',
    الوحدة: 'حبة',
    السعر: 'عشرة شواكل',
    'الحد الأدنى': '5',
    'اسم المورد': 'اختبار',
  },
  {
    'اسم الصنف': 'صنف بباركود قصير',
    الباركود: '12',
    التصنيف: 'معلبات',
    الوحدة: 'حبة',
    السعر: '7.50',
    'الحد الأدنى': '0',
    'اسم المورد': 'اختبار',
  },
]

function main() {
  const products = buildSeedProducts()
  const categoryNameByKey = new Map(seedCategories.map((c) => [c.key, c.nameAr]))
  const unitNameByKey = new Map(seedUnits.map((u) => [u.key, u.nameAr]))

  const rows = products.map((p) => {
    const defaultUnit = p.units.find((u) => u.isDefault)!
    const primaryBarcode = p.barcodes.find((b) => b.isPrimary)!
    return {
      'اسم الصنف': p.nameAr,
      الباركود: primaryBarcode.barcode,
      التصنيف: categoryNameByKey.get(p.categoryKey) ?? '',
      الوحدة: unitNameByKey.get(defaultUnit.unitKey) ?? '',
      السعر: defaultUnit.price,
      'الحد الأدنى': p.minStock,
      'اسم المورد': p.manufacturer ?? '',
    }
  })

  const sheet = XLSX.utils.json_to_sheet([...rows, ...BROKEN_ROWS])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'الأصناف')

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true })
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  writeFileSync(OUTPUT_PATH, buffer)

  console.log(
    '✓ كُتب ' +
      OUTPUT_PATH +
      ' — ' +
      rows.length +
      ' صفاً صالحاً + ' +
      BROKEN_ROWS.length +
      ' صفوف خاطئة عمداً'
  )
}

main()
