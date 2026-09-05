import { hash } from '@node-rs/argon2'
import { eq } from 'drizzle-orm'
import { connect, loadEnv } from '../client.js'
import type { Database } from '../client.js'
import {
  branches,
  cashRegisters,
  categories,
  paymentMethods,
  priceLists,
  productBarcodes,
  productPrices,
  productUnits,
  products,
  roles,
  sequences,
  taxes,
  tenants,
  units,
  users,
  warehouses,
} from '../schema/index.js'
import { ROLE_PERMISSIONS, SYSTEM_ROLES } from '../seed/permissions.js'
import { buildSeedProducts, seedCategories, seedUnits } from '../seed/catalog.js'

/**
 * بذرة مستأجر تجريبي كامل: «سوبرماركت الفلك».
 * المرجع: `docs/02-database.md §11` (البيانات الأولية) و`docs/01-project-and-permissions.md §5-§6`.
 *
 * حتمية: الأصناف تُولَّد ببذرة ثابتة (`src/seed/catalog.ts`) فتخرج نفس الـ500 صنف
 * بنفس الباركودات والأسعار في كل تشغيل، وتعتمد الاختبارات على ذلك.
 */

/** القيمة الافتراضية لكلمة مرور المالك — مرفوضة في الإنتاج */
const DEFAULT_OWNER_PASSWORD = 'falak123'

/** إعدادات argon2 — متوازنة بين الأمان وسرعة الدخول على جهاز ضعيف */
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const

/** PIN الكاشير التجريبي (`docs/04-execution-plan.md` · معيار إنجاز M1) */
const CASHIER_PIN = '1234'

function readOwnerPassword(): string {
  loadEnv()
  const password = process.env.SEED_OWNER_PASSWORD ?? DEFAULT_OWNER_PASSWORD
  if (process.env.NODE_ENV === 'production' && password === DEFAULT_OWNER_PASSWORD) {
    throw new Error(
      'رُفض تشغيل البذرة: NODE_ENV=production وكلمة مرور المالك ما زالت الافتراضية.\n' +
        'اضبط SEED_OWNER_PASSWORD بقيمة حقيقية، أو لا تشغّل البذرة على قاعدة إنتاج.'
    )
  }
  return password
}

async function seedTenant(db: Database) {
  const [tenant] = await db
    .insert(tenants)
    .values({
      name: 'سوبرماركت الفلك',
      businessType: 'supermarket',
      baseCurrency: 'ILS',
      timezone: 'Asia/Hebron',
      locale: 'ar',
      phone: '+970 2 222 0000',
      address: 'الخليل - فلسطين',
      // المفاتيح الموثّقة في docs/02-database.md §12.5 فقط
      settings: {
        tax_enabled: true,
        allow_negative_stock: false,
        shift_variance_alert: 50,
        'pos.lock_after_minutes': 10,
        'credit.default_limit': 0,
      },
    })
    .returning()
  if (!tenant) throw new Error('تعذّر إنشاء المستأجر')

  const [branch] = await db
    .insert(branches)
    .values({ tenantId: tenant.id, name: 'الفرع الرئيسي', isMain: true, phone: '+970 2 222 0000' })
    .returning()
  if (!branch) throw new Error('تعذّر إنشاء الفرع')

  const [warehouse] = await db
    .insert(warehouses)
    .values({ tenantId: tenant.id, branchId: branch.id, name: 'المخزن الرئيسي', isDefault: true })
    .returning()
  if (!warehouse) throw new Error('تعذّر إنشاء المخزن')

  await db.insert(cashRegisters).values({
    tenantId: tenant.id,
    branchId: branch.id,
    name: 'صندوق 1',
  })

  // طرق الدفع الثلاث (`docs/02-database.md §11`)
  await db.insert(paymentMethods).values([
    { tenantId: tenant.id, name: 'نقد', kind: 'cash', opensDrawer: true, sortOrder: 1 },
    { tenantId: tenant.id, name: 'بطاقة', kind: 'card', sortOrder: 2 },
    { tenantId: tenant.id, name: 'على الحساب', kind: 'credit', sortOrder: 3 },
  ])

  await db.insert(taxes).values({
    tenantId: tenant.id,
    name: 'ض.ق.م 16%',
    rate: '16.000',
    isInclusive: true,
    isDefault: true,
  })

  // تسلسل مستقل لكل نوع مستند في الفرع (`docs/02-database.md §3.8`)
  await db.insert(sequences).values([
    { tenantId: tenant.id, branchId: branch.id, seqKey: 'sale', prefix: 'BR1' },
    { tenantId: tenant.id, branchId: branch.id, seqKey: 'return', prefix: 'BR1-R' },
    { tenantId: tenant.id, branchId: branch.id, seqKey: 'purchase', prefix: 'BR1-P' },
  ])

  return { tenant, branch, warehouse }
}

async function seedRolesAndUsers(db: Database, tenantId: string, branchId: string) {
  const insertedRoles = await db
    .insert(roles)
    .values(
      SYSTEM_ROLES.map((name) => ({
        tenantId,
        name,
        permissions: [...ROLE_PERMISSIONS[name]],
        isSystem: true,
      }))
    )
    .returning()

  const roleByName = new Map(insertedRoles.map((r) => [r.name, r.id]))
  const ownerRoleId = roleByName.get('owner')
  const cashierRoleId = roleByName.get('cashier')
  if (!ownerRoleId || !cashierRoleId) throw new Error('تعذّر إنشاء أدوار النظام')

  const [passwordHash, pinHash] = await Promise.all([
    hash(readOwnerPassword(), ARGON2_OPTIONS),
    hash(CASHIER_PIN, ARGON2_OPTIONS),
  ])

  await db.insert(users).values([
    {
      tenantId,
      roleId: ownerRoleId,
      branchId,
      fullName: 'خالد',
      username: 'khaled',
      passwordHash,
      phone: '+970 599 000 000',
    },
    {
      tenantId,
      roleId: cashierRoleId,
      branchId,
      fullName: 'سامي',
      username: 'cashier',
      pinHash,
    },
  ])

  return { roleCount: insertedRoles.length }
}

async function seedCatalog(db: Database, tenantId: string) {
  const insertedUnits = await db
    .insert(units)
    .values(
      seedUnits.map((u) => ({
        tenantId,
        nameAr: u.nameAr,
        nameEn: u.nameEn,
        symbol: u.symbol,
        allowFraction: u.allowFraction,
      }))
    )
    .returning()
  const unitIdByKey = new Map(seedUnits.map((u, i) => [u.key, insertedUnits[i]!.id]))

  const insertedCategories = await db
    .insert(categories)
    .values(
      seedCategories.map((c, i) => ({ tenantId, nameAr: c.nameAr, nameEn: c.nameEn, sortOrder: i }))
    )
    .returning()
  const categoryIdByKey = new Map(seedCategories.map((c, i) => [c.key, insertedCategories[i]!.id]))

  const [retailList] = await db
    .insert(priceLists)
    .values({ tenantId, name: 'تجزئة', currencyCode: 'ILS', isDefault: true })
    .returning()
  if (!retailList) throw new Error('تعذّر إنشاء قائمة الأسعار')

  const [defaultTax] = await db.select().from(taxes).where(eq(taxes.tenantId, tenantId)).limit(1)

  const seedProducts = buildSeedProducts()

  const insertedProducts = await db
    .insert(products)
    .values(
      seedProducts.map((p) => ({
        tenantId,
        categoryId: categoryIdByKey.get(p.categoryKey)!,
        baseUnitId: unitIdByKey.get(p.baseUnitKey)!,
        taxId: defaultTax?.id ?? null,
        sku: p.sku,
        nameAr: p.nameAr,
        nameEn: p.nameEn,
        productType: p.isWeighed ? ('weighed' as const) : ('standard' as const),
        trackExpiry: p.trackExpiry,
        isWeighed: p.isWeighed,
        pluCode: p.pluCode,
        minStock: p.minStock,
        manufacturer: p.manufacturer,
      }))
    )
    .returning({ id: products.id })

  // وحدات البيع: صف لكل وحدة لكل صنف. نحتفظ بفهرس موازٍ لربط الأسعار والباركودات بها.
  const unitRows: (typeof productUnits.$inferInsert)[] = []
  const unitIndex: { productIndex: number; unitKey: string }[] = []
  seedProducts.forEach((p, i) => {
    for (const u of p.units) {
      unitRows.push({
        tenantId,
        productId: insertedProducts[i]!.id,
        unitId: unitIdByKey.get(u.unitKey)!,
        factor: u.factor,
        isDefault: u.isDefault,
      })
      unitIndex.push({ productIndex: i, unitKey: u.unitKey })
    }
  })
  const insertedUnitRows = await db
    .insert(productUnits)
    .values(unitRows)
    .returning({ id: productUnits.id })

  const priceRows: (typeof productPrices.$inferInsert)[] = unitIndex.map((ref, i) => {
    const source = seedProducts[ref.productIndex]!.units.find((u) => u.unitKey === ref.unitKey)!
    return {
      tenantId,
      productUnitId: insertedUnitRows[i]!.id,
      priceListId: retailList.id,
      price: source.price,
      minPrice: source.minPrice,
    }
  })
  await db.insert(productPrices).values(priceRows)

  // خريطة (فهرس الصنف، مفتاح الوحدة) ← معرّف صف الوحدة، لربط باركود الكرتونة بوحدتها
  const unitRowIdByProductAndKey = new Map<string, string>()
  unitIndex.forEach((ref, i) => {
    unitRowIdByProductAndKey.set(ref.productIndex + ':' + ref.unitKey, insertedUnitRows[i]!.id)
  })

  const barcodeRows: (typeof productBarcodes.$inferInsert)[] = []
  seedProducts.forEach((p, i) => {
    for (const b of p.barcodes) {
      barcodeRows.push({
        tenantId,
        productId: insertedProducts[i]!.id,
        productUnitId: b.unitKey
          ? (unitRowIdByProductAndKey.get(i + ':' + b.unitKey) ?? null)
          : null,
        barcode: b.barcode,
        isPrimary: b.isPrimary,
      })
    }
  })
  await db.insert(productBarcodes).values(barcodeRows)

  return {
    units: insertedUnits.length,
    categories: insertedCategories.length,
    products: insertedProducts.length,
    productUnits: insertedUnitRows.length,
    prices: priceRows.length,
    barcodes: barcodeRows.length,
  }
}

/** يبذر مستأجراً كاملاً. يرفض العمل على قاعدة فيها بيانات أصلاً. */
export async function seed(db: Database) {
  const existing = await db.select({ id: tenants.id }).from(tenants).limit(1)
  if (existing.length > 0) {
    throw new Error(
      'القاعدة تحتوي مستأجراً بالفعل. استخدم `pnpm db:reset` لهدمها وإعادة بنائها من الصفر.'
    )
  }

  const { tenant, branch } = await seedTenant(db)
  const roleInfo = await seedRolesAndUsers(db, tenant.id, branch.id)
  const catalogInfo = await seedCatalog(db, tenant.id)

  return { tenant, ...roleInfo, ...catalogInfo }
}

async function main() {
  const { db, close } = connect()
  try {
    const started = Date.now()
    const result = await seed(db)
    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    console.log('✓ بُذر المستأجر «' + result.tenant.name + '» في ' + seconds + ' ثانية:')
    console.log(
      '  الأدوار: ' +
        result.roleCount +
        ' · المستخدمون: 2 (khaled بكلمة مرور، cashier بـ PIN ' +
        CASHIER_PIN +
        ')'
    )
    console.log('  الوحدات: ' + result.units + ' · التصنيفات: ' + result.categories)
    console.log('  الأصناف: ' + result.products + ' · وحدات البيع: ' + result.productUnits)
    console.log('  الأسعار: ' + result.prices + ' · الباركودات: ' + result.barcodes)
  } finally {
    await close()
  }
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('/scripts/seed.ts')
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
