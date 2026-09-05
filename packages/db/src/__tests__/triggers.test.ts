import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import {
  createMinimalTenant,
  setupTestDatabase,
  truncateBusinessTables,
  type MinimalTenant,
  type TestContext,
} from './helpers.js'
import {
  customerTransactions,
  customers,
  products,
  stockBatches,
  stockLevels,
  stockMovements,
  suppliers,
  supplierTransactions,
  units,
} from '../schema/index.js'

/**
 * تريجرات القاعدة — القاعدة 2 في `CLAUDE.md`: الأرصدة **لا تُكتب مباشرة**،
 * التريجرات وحدها تشتقّها من جداول الحركات. هذه الاختبارات تثبت ذلك.
 * المرجع: `docs/02-database.md §4`.
 */

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

async function createProduct(nameAr = 'صنف اختبار') {
  const [product] = await ctx.db
    .insert(products)
    .values({ tenantId: tenant.tenantId, baseUnitId: unitId, nameAr })
    .returning()
  return product!
}

describe('apply_stock_movement — متوسط التكلفة المرجّح', () => {
  it('السيناريو الموثّق في docs/02-database.md §4: شراء 10×4.00 ثم 10×6.00 ثم بيع 3', async () => {
    const product = await createProduct()

    // دخول أول: 10 حبات بتكلفة 4.00
    await ctx.db.insert(stockMovements).values({
      tenantId: tenant.tenantId,
      productId: product.id,
      warehouseId: tenant.warehouseId,
      movementType: 'purchase',
      qty: '10.000',
      unitCost: '4.0000',
    })

    // دخول ثانٍ: 10 حبات بتكلفة 6.00 ⇒ المتوسط يصبح 5.0000
    await ctx.db.insert(stockMovements).values({
      tenantId: tenant.tenantId,
      productId: product.id,
      warehouseId: tenant.warehouseId,
      movementType: 'purchase',
      qty: '10.000',
      unitCost: '6.0000',
    })

    const [afterPurchases] = await ctx.db
      .select()
      .from(stockLevels)
      .where(
        and(eq(stockLevels.productId, product.id), eq(stockLevels.warehouseId, tenant.warehouseId))
      )
    expect(afterPurchases?.qtyOnHand).toBe('20.000')
    expect(afterPurchases?.avgCost).toBe('5.0000')

    // خروج: بيع 3 حبات — الكمية تنقص والمتوسط **لا يتغيّر**
    await ctx.db.insert(stockMovements).values({
      tenantId: tenant.tenantId,
      productId: product.id,
      warehouseId: tenant.warehouseId,
      movementType: 'sale',
      qty: '-3.000',
      unitCost: '5.0000',
    })

    const [afterSale] = await ctx.db
      .select()
      .from(stockLevels)
      .where(
        and(eq(stockLevels.productId, product.id), eq(stockLevels.warehouseId, tenant.warehouseId))
      )
    expect(afterSale?.qtyOnHand).toBe('17.000')
    expect(afterSale?.avgCost).toBe('5.0000')
  })

  it('البيع وحده لا يغيّر متوسط التكلفة مهما تكرّر', async () => {
    const product = await createProduct()
    await ctx.db.insert(stockMovements).values({
      tenantId: tenant.tenantId,
      productId: product.id,
      warehouseId: tenant.warehouseId,
      movementType: 'purchase',
      qty: '100.000',
      unitCost: '7.5000',
    })

    for (let i = 0; i < 5; i++) {
      await ctx.db.insert(stockMovements).values({
        tenantId: tenant.tenantId,
        productId: product.id,
        warehouseId: tenant.warehouseId,
        movementType: 'sale',
        qty: '-2.000',
        // تكلفة خروج مختلفة عمداً — يجب ألا تؤثر على المتوسط
        unitCost: '99.0000',
      })
    }

    const [level] = await ctx.db
      .select()
      .from(stockLevels)
      .where(eq(stockLevels.productId, product.id))
    expect(level?.qtyOnHand).toBe('90.000')
    expect(level?.avgCost).toBe('7.5000')
  })

  it('يحدّث qty_on_hand للدفعة عند ربط الحركة بها', async () => {
    const product = await createProduct()
    const [batch] = await ctx.db
      .insert(stockBatches)
      .values({
        tenantId: tenant.tenantId,
        productId: product.id,
        warehouseId: tenant.warehouseId,
        batchNo: 'L-001',
        unitCost: '4.0000',
      })
      .returning()

    await ctx.db.insert(stockMovements).values({
      tenantId: tenant.tenantId,
      productId: product.id,
      warehouseId: tenant.warehouseId,
      batchId: batch!.id,
      movementType: 'purchase',
      qty: '25.000',
      unitCost: '4.0000',
    })
    await ctx.db.insert(stockMovements).values({
      tenantId: tenant.tenantId,
      productId: product.id,
      warehouseId: tenant.warehouseId,
      batchId: batch!.id,
      movementType: 'sale',
      qty: '-5.000',
      unitCost: '4.0000',
    })

    const [updated] = await ctx.db.select().from(stockBatches).where(eq(stockBatches.id, batch!.id))
    expect(updated?.qtyOnHand).toBe('20.000')
  })
})

describe('apply_customer_transaction — رصيد العميل من دفتر الحركات', () => {
  it('فاتورة 150 ثم دفعة 50 تجعل الرصيد 100', async () => {
    const [customer] = await ctx.db
      .insert(customers)
      .values({ tenantId: tenant.tenantId, name: 'أبو محمد' })
      .returning()
    expect(customer?.balance).toBe('0.00')

    // موجب = عليه لنا (`docs/02-database.md §3.6`)
    await ctx.db.insert(customerTransactions).values({
      tenantId: tenant.tenantId,
      customerId: customer!.id,
      kind: 'invoice',
      amountBase: '150.00',
    })
    await ctx.db.insert(customerTransactions).values({
      tenantId: tenant.tenantId,
      customerId: customer!.id,
      kind: 'payment',
      amountBase: '-50.00',
    })

    const [afterPayment] = await ctx.db
      .select()
      .from(customers)
      .where(eq(customers.id, customer!.id))
    expect(afterPayment?.balance).toBe('100.00')
  })

  it('رصيد المورد يتحرك بنفس المنطق', async () => {
    const [supplier] = await ctx.db
      .insert(suppliers)
      .values({ tenantId: tenant.tenantId, name: 'شركة التوزيع' })
      .returning()

    await ctx.db.insert(supplierTransactions).values({
      tenantId: tenant.tenantId,
      supplierId: supplier!.id,
      kind: 'invoice',
      amountBase: '900.00',
    })
    await ctx.db.insert(supplierTransactions).values({
      tenantId: tenant.tenantId,
      supplierId: supplier!.id,
      kind: 'payment',
      amountBase: '-350.50',
    })

    const [updated] = await ctx.db.select().from(suppliers).where(eq(suppliers.id, supplier!.id))
    expect(updated?.balance).toBe('549.50')
  })
})

describe('set_updated_at', () => {
  it('يحدّث updated_at تلقائياً عند أي UPDATE', async () => {
    const product = await createProduct('صنف قبل التعديل')
    const before = product.updatedAt

    await new Promise((resolve) => setTimeout(resolve, 10))
    await ctx.db
      .update(products)
      .set({ nameAr: 'صنف بعد التعديل' })
      .where(eq(products.id, product.id))

    const [updated] = await ctx.db.select().from(products).where(eq(products.id, product.id))
    expect(updated!.updatedAt.getTime()).toBeGreaterThan(before.getTime())
  })

  it('يعمل على الجداول التي أضاف لها الترحيل 0002 العمود (ADR-003)', async () => {
    const product = await createProduct()
    const { rows: inserted } = await ctx.pool.query<{ id: string; updated_at: Date }>(
      `INSERT INTO product_barcodes (tenant_id, product_id, barcode)
       VALUES ($1, $2, '6251234567890') RETURNING id, updated_at`,
      [tenant.tenantId, product.id]
    )
    const before = inserted[0]!.updated_at

    await new Promise((resolve) => setTimeout(resolve, 10))
    const { rows: after } = await ctx.pool.query<{ updated_at: Date }>(
      `UPDATE product_barcodes SET is_primary = true WHERE id = $1 RETURNING updated_at`,
      [inserted[0]!.id]
    )
    expect(after[0]!.updated_at.getTime()).toBeGreaterThan(before.getTime())
  })
})
