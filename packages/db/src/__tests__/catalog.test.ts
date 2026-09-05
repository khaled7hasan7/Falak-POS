import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, isNull, sql } from 'drizzle-orm'
import {
  createMinimalTenant,
  setupTestDatabase,
  truncateBusinessTables,
  type MinimalTenant,
  type TestContext,
} from './helpers.js'
import { productBarcodes, products, sequences, units } from '../schema/index.js'
import { ean13CheckDigit, isValidEan13, seedBarcode, toEan13 } from '../seed/ean13.js'
import { buildSeedProducts } from '../seed/catalog.js'

let ctx: TestContext
let tenant: MinimalTenant
let unitId: string

beforeAll(async () => {
  ctx = await setupTestDatabase()
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(async () => {
  await truncateBusinessTables(ctx.pool)
  tenant = await createMinimalTenant(ctx)
  const [unit] = await ctx.db
    .insert(units)
    .values({ tenantId: tenant.tenantId, nameAr: 'حبة', allowFraction: false })
    .returning()
  unitId = unit!.id
})

async function createProduct(nameAr: string) {
  const [product] = await ctx.db
    .insert(products)
    .values({ tenantId: tenant.tenantId, baseUnitId: unitId, nameAr })
    .returning()
  return product!
}

describe('next_invoice_no — أرقام فواتير بلا فجوات', () => {
  beforeEach(async () => {
    await ctx.db.insert(sequences).values({
      tenantId: tenant.tenantId,
      branchId: tenant.branchId,
      seqKey: 'sale',
      prefix: 'BR1',
    })
  })

  async function nextInvoiceNo(): Promise<string> {
    const { rows } = await ctx.pool.query<{ next_invoice_no: string }>(
      'SELECT next_invoice_no($1, $2, $3)',
      [tenant.tenantId, tenant.branchId, 'sale']
    )
    return rows[0]!.next_invoice_no
  }

  it('يبدأ من 000001 ويتسلسل بلا فجوة', async () => {
    const year = new Date().getFullYear()
    expect(await nextInvoiceNo()).toBe(`BR1-${year}-000001`)
    expect(await nextInvoiceNo()).toBe(`BR1-${year}-000002`)
    expect(await nextInvoiceNo()).toBe(`BR1-${year}-000003`)
  })

  it('الاستدعاءات المتزامنة تعطي أرقاماً متمايزة (لا تكرار تحت التزاحم)', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => nextInvoiceNo()))
    expect(new Set(results).size).toBe(20)

    const serials = results.map((r) => Number(r.split('-')[2])).sort((a, b) => a - b)
    // متسلسلة تماماً من 1 إلى 20 — لا فجوات ولا قفزات
    expect(serials).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
  })

  it('يرفع خطأً واضحاً إن لم يُهيَّأ التسلسل للفرع', async () => {
    await expect(
      ctx.pool.query('SELECT next_invoice_no($1, $2, $3)', [
        tenant.tenantId,
        tenant.branchId,
        'purchase',
      ])
    ).rejects.toThrow(/sequence purchase not initialised/)
  })
})

describe('الحذف الناعم', () => {
  it('الصنف المحذوف ناعماً لا يظهر في استعلامات البحث', async () => {
    const kept = await createProduct('حليب طازج')
    const removed = await createProduct('حليب منتهي')

    await ctx.db.update(products).set({ deletedAt: new Date() }).where(eq(products.id, removed.id))

    // القاعدة 1: كل قراءة تضيف deleted_at IS NULL و tenant_id
    const visible = await ctx.db
      .select({ id: products.id, nameAr: products.nameAr })
      .from(products)
      .where(
        and(
          eq(products.tenantId, tenant.tenantId),
          isNull(products.deletedAt),
          sql`${products.nameAr} ILIKE ${'%حليب%'}`
        )
      )

    expect(visible).toHaveLength(1)
    expect(visible[0]!.id).toBe(kept.id)

    // الصف نفسه ما زال موجوداً — لا DELETE فعلي
    const all = await ctx.db.select().from(products).where(eq(products.tenantId, tenant.tenantId))
    expect(all).toHaveLength(2)
  })
})

describe('UNIQUE (tenant_id, barcode)', () => {
  it('يرفض باركوداً مكرراً داخل نفس المستأجر', async () => {
    const first = await createProduct('صنف أ')
    const second = await createProduct('صنف ب')

    await ctx.db.insert(productBarcodes).values({
      tenantId: tenant.tenantId,
      productId: first.id,
      barcode: '6251234567890',
    })

    // Drizzle يغلّف خطأ السائق، فنتحقق من رمز PostgreSQL نفسه:
    // 23505 = unique_violation — أدقّ من مطابقة نص الرسالة.
    const duplicate = ctx.db.insert(productBarcodes).values({
      tenantId: tenant.tenantId,
      productId: second.id,
      barcode: '6251234567890',
    })

    await expect(duplicate).rejects.toSatisfy(
      (error: unknown) => (error as { cause?: { code?: string } })?.cause?.code === '23505',
      'يجب أن يفشل بـ unique_violation (23505)'
    )
  })

  it('يسمح بنفس الباركود لمستأجر آخر', async () => {
    const product = await createProduct('صنف أ')
    await ctx.db.insert(productBarcodes).values({
      tenantId: tenant.tenantId,
      productId: product.id,
      barcode: '6259999999998',
    })

    const other = await createMinimalTenant(ctx, 'مستأجر ثانٍ')
    const [otherUnit] = await ctx.db
      .insert(units)
      .values({ tenantId: other.tenantId, nameAr: 'حبة', allowFraction: false })
      .returning()
    const [otherProduct] = await ctx.db
      .insert(products)
      .values({ tenantId: other.tenantId, baseUnitId: otherUnit!.id, nameAr: 'صنف مستأجر آخر' })
      .returning()

    await expect(
      ctx.db.insert(productBarcodes).values({
        tenantId: other.tenantId,
        productId: otherProduct!.id,
        barcode: '6259999999998',
      })
    ).resolves.toBeDefined()
  })
})

describe('EAN-13', () => {
  it('يحسب رقم التحقق لباركودات معروفة', () => {
    // أمثلة قياسية موثّقة لمعيار EAN-13
    expect(ean13CheckDigit('400638133393')).toBe(1)
    expect(ean13CheckDigit('590123412345')).toBe(7)
    expect(ean13CheckDigit('978020137962')).toBe(4)
  })

  it('يتحقق من الباركودات الصحيحة ويرفض الخاطئة', () => {
    expect(isValidEan13('4006381333931')).toBe(true)
    expect(isValidEan13('5901234123457')).toBe(true)
    // رقم تحقق خاطئ
    expect(isValidEan13('4006381333932')).toBe(false)
    // طول خاطئ
    expect(isValidEan13('400638133393')).toBe(false)
    // أحرف
    expect(isValidEan13('40063813339A1')).toBe(false)
  })

  it('يرفض مدخلاً ليس 12 رقماً', () => {
    expect(() => ean13CheckDigit('123')).toThrow(/12 رقماً/)
  })

  it('toEan13 ينتج باركوداً صالحاً دائماً', () => {
    for (const body of ['625000000001', '628123456789', '729987654321']) {
      expect(isValidEan13(toEan13(body))).toBe(true)
    }
  })

  it('seedBarcode لا ينتج باركوداً يبدأ بـ2 (بادئة الميزان محجوزة)', () => {
    for (let i = 0; i < 200; i++) {
      const code = seedBarcode(i, i + 1)
      expect(isValidEan13(code)).toBe(true)
      expect(code.startsWith('2')).toBe(false)
    }
  })
})

describe('مولّد الكتالوج حتمي', () => {
  it('يعطي نفس الـ500 صنف في كل استدعاء', () => {
    const first = buildSeedProducts()
    const second = buildSeedProducts()
    expect(first).toHaveLength(500)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('كل الباركودات صالحة وفريدة ولا تبدأ بـ2', () => {
    const generated = buildSeedProducts()
    const all = generated.flatMap((p) => p.barcodes.map((b) => b.barcode))

    expect(new Set(all).size).toBe(all.length)
    for (const code of all) {
      expect(isValidEan13(code)).toBe(true)
      expect(code.startsWith('2')).toBe(false)
    }
  })

  it('يحقق حدود البذرة: وحدة افتراضية واحدة، وأصناف بوحدتين، وأصناف بعدة باركودات', () => {
    const generated = buildSeedProducts()

    for (const p of generated) {
      expect(p.units.filter((u) => u.isDefault)).toHaveLength(1)
      expect(p.barcodes.filter((b) => b.isPrimary)).toHaveLength(1)
    }

    expect(generated.filter((p) => p.units.length > 1).length).toBeGreaterThanOrEqual(60)
    expect(generated.filter((p) => p.barcodes.length > 1).length).toBeGreaterThanOrEqual(20)
    // كل صنف موزون يحمل كود ميزان (قيد نموذج الصنف في contracts)
    for (const p of generated.filter((x) => x.isWeighed)) {
      expect(p.pluCode).toMatch(/^\d{3,6}$/)
    }
  })
})
