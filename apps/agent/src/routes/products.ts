import { productInput, productListQuery } from '@falak/contracts'
import {
  categories,
  priceLists,
  productBarcodes,
  productPrices,
  productUnits,
  products,
  units,
} from '@falak/db'
import type { Database, Executor } from '@falak/db'
import { and, asc, count, eq, isNull, or, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { PERMISSIONS } from '../auth/permissions.js'
import { withAudit } from '../audit.js'

/**
 * الأصناف: قائمة، تفصيل، إنشاء، تعديل، حذف ناعم، بحث بالباركود وبالاسم.
 * المرجع: `docs/02-database.md §5.1` (بحث الباركود) و`§3.1` (السطر يشير للوحدة).
 */

/** أقل عدد حروف لبدء البحث بالاسم (`docs/03-design-system.md §6.2`) */
const MIN_SEARCH_LENGTH = 2

/**
 * حقول السعر التي قد تصل داخل جسم تعديل الصنف.
 *
 * **ثغرة يجب ألا تتكرر:** لو فُحصت `products.edit_price` في مسار السعر وحده
 * ونُسيت هنا، لاستطاع الكاشير تغيير الأسعار عبر مسار تعديل الصنف العادي.
 * لذلك أي جسم يحمل أسعاراً يُفحص هنا أيضاً.
 */
function bodyTouchesPrices(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false
  const units = (body as { units?: unknown }).units
  if (!Array.isArray(units)) return false
  return units.some(
    (unit) =>
      typeof unit === 'object' &&
      unit !== null &&
      Array.isArray((unit as { prices?: unknown }).prices) &&
      (unit as { prices: unknown[] }).prices.length > 0
  )
}

export async function productRoutes(app: FastifyInstance): Promise<void> {
  const tenantOf = (request: { session?: { tenantId: string } }) => request.session!.tenantId
  const contextOf = (request: { session?: { tenantId: string; sub: string } }) => ({
    tenantId: request.session!.tenantId,
    userId: request.session!.sub,
  })

  /* ── البحث بالباركود: المسار الأسرع في النظام (docs/02 §5.1) ───────────── */
  app.get<{ Params: { code: string }; Querystring: { priceListId?: string } }>(
    '/barcode/:code',
    { onRequest: app.requirePermission(PERMISSIONS.PRODUCTS_VIEW) },
    async (request, reply) => {
      const tenantId = tenantOf(request)
      const priceListId = request.query.priceListId ?? (await defaultPriceListId(app.db, tenantId))

      const started = performance.now()
      // الاستعلام حرفياً من docs/02-database.md §5.1 — الهدف أقل من 5ms
      const { rows } = await app.pool.query(
        `SELECT p.id, p.name_ar, pu.id AS product_unit_id, pu.factor, pp.price, pp.min_price,
                u.name_ar AS unit_name_ar, p.is_weighed, p.track_expiry
         FROM product_barcodes pb
         JOIN products p        ON p.id = pb.product_id AND p.deleted_at IS NULL
         JOIN product_units pu  ON pu.id = COALESCE(pb.product_unit_id,
                                   (SELECT id FROM product_units
                                    WHERE product_id = p.id AND is_default LIMIT 1))
         JOIN units u           ON u.id = pu.unit_id
         LEFT JOIN product_prices pp ON pp.product_unit_id = pu.id AND pp.price_list_id = $2
         WHERE pb.tenant_id = $1 AND pb.barcode = $3 AND pb.deleted_at IS NULL`,
        [tenantId, priceListId, request.params.code]
      )
      const elapsedMs = performance.now() - started

      const row = rows[0] as
        | {
            id: string
            name_ar: string
            product_unit_id: string
            factor: string
            price: string | null
            min_price: string | null
            unit_name_ar: string
            is_weighed: boolean
            track_expiry: boolean
          }
        | undefined

      if (!row) {
        return reply.code(404).send({
          error: {
            code: 'barcode_not_found',
            message: 'لا صنف بهذا الباركود. أضفه أو ابحث بالاسم.',
          },
          elapsedMs,
        })
      }

      return {
        productId: row.id,
        nameAr: row.name_ar,
        productUnitId: row.product_unit_id,
        unitNameAr: row.unit_name_ar,
        factor: row.factor,
        price: row.price,
        minPrice: row.min_price,
        isWeighed: row.is_weighed,
        trackExpiry: row.track_expiry,
        scannedBarcode: request.params.code,
        weightFromBarcode: null,
        elapsedMs,
      }
    }
  )

  /* ── البحث بالاسم (trigram) ─────────────────────────────────────────────── */
  app.get<{ Querystring: { q?: string } }>(
    '/search',
    { onRequest: app.requirePermission(PERMISSIONS.PRODUCTS_VIEW) },
    async (request) => {
      const query = (request.query.q ?? '').trim()
      if (query.length < MIN_SEARCH_LENGTH) return { rows: [] }

      const started = performance.now()
      const rows = await app.db
        .select({
          id: products.id,
          nameAr: products.nameAr,
          sku: products.sku,
          isWeighed: products.isWeighed,
        })
        .from(products)
        .where(
          and(
            eq(products.tenantId, tenantOf(request)),
            isNull(products.deletedAt),
            or(
              sql`${products.nameAr} ILIKE ${'%' + query + '%'}`,
              sql`${products.sku} ILIKE ${query + '%'}`
            )
          )
        )
        .orderBy(sql`similarity(${products.nameAr}, ${query}) DESC`)
        .limit(20)

      return { rows, elapsedMs: performance.now() - started }
    }
  )

  /* ── القائمة ────────────────────────────────────────────────────────────── */
  app.get(
    '/',
    { onRequest: app.requirePermission(PERMISSIONS.PRODUCTS_VIEW) },
    async (request, reply) => {
      const parsed = productListQuery.safeParse(request.query)
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: { code: 'invalid_query', message: 'معايير البحث غير صالحة.' } })
      }
      const { q, categoryId, isActive, page, perPage } = parsed.data
      const tenantId = tenantOf(request)

      const filters = [eq(products.tenantId, tenantId), isNull(products.deletedAt)]
      if (categoryId) filters.push(eq(products.categoryId, categoryId))
      if (isActive !== undefined) filters.push(eq(products.isActive, isActive))
      if (q && q.trim().length >= MIN_SEARCH_LENGTH) {
        const term = q.trim()
        filters.push(
          or(
            sql`${products.nameAr} ILIKE ${'%' + term + '%'}`,
            sql`${products.sku} ILIKE ${term + '%'}`,
            sql`EXISTS (SELECT 1 FROM product_barcodes b
                        WHERE b.product_id = ${products.id} AND b.barcode = ${term}
                          AND b.deleted_at IS NULL)`
          )!
        )
      }

      const where = and(...filters)
      const [{ value: total } = { value: 0 }] = await app.db
        .select({ value: count() })
        .from(products)
        .where(where)

      const rows = await app.db
        .select({
          id: products.id,
          nameAr: products.nameAr,
          nameEn: products.nameEn,
          sku: products.sku,
          isWeighed: products.isWeighed,
          isActive: products.isActive,
          categoryNameAr: categories.nameAr,
        })
        .from(products)
        .leftJoin(categories, eq(categories.id, products.categoryId))
        .where(where)
        .orderBy(asc(products.nameAr))
        .limit(perPage)
        .offset((page - 1) * perPage)

      return { rows, total, page, perPage }
    }
  )

  /* ── تفصيل صنف ──────────────────────────────────────────────────────────── */
  app.get<{ Params: { id: string } }>(
    '/:id',
    { onRequest: app.requirePermission(PERMISSIONS.PRODUCTS_VIEW) },
    async (request, reply) => {
      const product = await loadProduct(app.db, tenantOf(request), request.params.id)
      if (!product) {
        return reply
          .code(404)
          .send({ error: { code: 'not_found', message: 'غير موجود — ربما حُذف.' } })
      }
      return product
    }
  )

  /* ── إنشاء ──────────────────────────────────────────────────────────────── */
  app.post(
    '/',
    { onRequest: app.requirePermission(PERMISSIONS.PRODUCTS_CREATE) },
    async (request, reply) => {
      const parsed = productInput.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'invalid_input',
            message: parsed.error.issues[0]?.message ?? 'بيانات الصنف غير صالحة.',
            field: parsed.error.issues[0]?.path.join('.'),
          },
        })
      }

      // نفس الحارس المذكور أعلاه: لا أسعار بلا صلاحية تعديل الأسعار
      if (bodyTouchesPrices(parsed.data) && !hasPricePermission(request)) {
        return priceForbidden(reply)
      }

      const input = parsed.data
      const tenantId = tenantOf(request)

      const created = await withAudit(app.db, contextOf(request), async (tx) => {
        const [row] = await tx
          .insert(products)
          .values({
            tenantId,
            categoryId: input.categoryId ?? null,
            baseUnitId: input.baseUnitId,
            taxId: input.taxId ?? null,
            sku: input.sku ?? null,
            nameAr: input.nameAr,
            nameEn: input.nameEn ?? null,
            productType: input.productType,
            trackExpiry: input.trackExpiry,
            trackBatches: input.trackBatches,
            isWeighed: input.isWeighed,
            pluCode: input.pluCode ?? null,
            costMethod: input.costMethod,
            minStock: input.minStock,
            reorderQty: input.reorderQty,
            manufacturer: input.manufacturer ?? null,
            imageUrl: input.imageUrl ?? null,
            isActive: input.isActive,
          })
          .returning()

        await writeUnitsAndBarcodes(tx, tenantId, row!.id, input)

        return {
          result: row!,
          entry: {
            action: 'product.created',
            entity: 'products',
            entityId: row!.id,
            after: row,
          },
        }
      })

      return reply.code(201).send(await loadProduct(app.db, tenantId, created.id))
    }
  )

  /* ── تعديل ──────────────────────────────────────────────────────────────── */
  app.put<{ Params: { id: string } }>(
    '/:id',
    { onRequest: app.requirePermission(PERMISSIONS.PRODUCTS_EDIT) },
    async (request, reply) => {
      const parsed = productInput.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'invalid_input',
            message: parsed.error.issues[0]?.message ?? 'بيانات الصنف غير صالحة.',
            field: parsed.error.issues[0]?.path.join('.'),
          },
        })
      }

      // الفحص الحاسم: تعديل الصنف لا يفتح باباً خلفياً لتعديل الأسعار
      if (bodyTouchesPrices(parsed.data) && !hasPricePermission(request)) {
        return priceForbidden(reply)
      }

      const tenantId = tenantOf(request)
      const input = parsed.data

      const [existing] = await app.db
        .select()
        .from(products)
        .where(
          and(
            eq(products.id, request.params.id),
            eq(products.tenantId, tenantId),
            isNull(products.deletedAt)
          )
        )
        .limit(1)

      if (!existing) {
        return reply
          .code(404)
          .send({ error: { code: 'not_found', message: 'غير موجود — ربما حُذف.' } })
      }

      await withAudit(app.db, contextOf(request), async (tx) => {
        const [row] = await tx
          .update(products)
          .set({
            categoryId: input.categoryId ?? null,
            baseUnitId: input.baseUnitId,
            taxId: input.taxId ?? null,
            sku: input.sku ?? null,
            nameAr: input.nameAr,
            nameEn: input.nameEn ?? null,
            productType: input.productType,
            trackExpiry: input.trackExpiry,
            trackBatches: input.trackBatches,
            isWeighed: input.isWeighed,
            pluCode: input.pluCode ?? null,
            costMethod: input.costMethod,
            minStock: input.minStock,
            reorderQty: input.reorderQty,
            manufacturer: input.manufacturer ?? null,
            imageUrl: input.imageUrl ?? null,
            isActive: input.isActive,
          })
          .where(eq(products.id, existing.id))
          .returning()

        // الحذف الناعم للوحدات والباركودات القديمة ثم إعادة الكتابة (القاعدة 1)
        await tx
          .update(productBarcodes)
          .set({ deletedAt: new Date() })
          .where(and(eq(productBarcodes.productId, existing.id), isNull(productBarcodes.deletedAt)))
        await tx
          .update(productUnits)
          .set({ deletedAt: new Date() })
          .where(and(eq(productUnits.productId, existing.id), isNull(productUnits.deletedAt)))

        await writeUnitsAndBarcodes(tx, tenantId, existing.id, input)

        return {
          result: row!,
          entry: {
            action: 'product.updated',
            entity: 'products',
            entityId: existing.id,
            before: existing,
            after: row,
          },
        }
      })

      return loadProduct(app.db, tenantId, existing.id)
    }
  )

  /* ── حذف ناعم ───────────────────────────────────────────────────────────── */
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { onRequest: app.requirePermission(PERMISSIONS.PRODUCTS_DELETE) },
    async (request, reply) => {
      const tenantId = tenantOf(request)
      const [existing] = await app.db
        .select()
        .from(products)
        .where(
          and(
            eq(products.id, request.params.id),
            eq(products.tenantId, tenantId),
            isNull(products.deletedAt)
          )
        )
        .limit(1)

      if (!existing) {
        return reply
          .code(404)
          .send({ error: { code: 'not_found', message: 'غير موجود — ربما حُذف.' } })
      }

      await withAudit(app.db, contextOf(request), async (tx) => {
        // القاعدة 1: لا DELETE فعلي — `deleted_at` فقط
        const [row] = await tx
          .update(products)
          .set({ deletedAt: new Date() })
          .where(eq(products.id, existing.id))
          .returning()

        return {
          result: row!,
          entry: {
            action: 'product.deleted',
            entity: 'products',
            entityId: existing.id,
            before: existing,
            after: row,
            syncOp: 'update' as const,
          },
        }
      })

      return reply.code(204).send()
    }
  )
}

function hasPricePermission(request: { session?: { permissions: string[] } }): boolean {
  return request.session?.permissions.includes(PERMISSIONS.PRODUCTS_EDIT_PRICE) ?? false
}

function priceForbidden(reply: {
  code: (n: number) => { send: (body: unknown) => unknown }
}): unknown {
  return reply.code(403).send({
    error: {
      code: 'forbidden',
      message: 'لا تملك صلاحية تعديل الأسعار. احفظ الصنف بلا أسعار أو اطلب من المدير.',
      field: 'units.prices',
    },
  })
}

/** يكتب وحدات البيع وأسعارها وباركوداتها — تُستدعى داخل معاملة الإنشاء أو التعديل */
async function writeUnitsAndBarcodes(
  tx: Executor,
  tenantId: string,
  productId: string,
  input: { units: readonly unknown[]; barcodes: readonly unknown[] }
): Promise<void> {
  type UnitInput = {
    unitId: string
    factor: string
    isDefault: boolean
    prices: { priceListId: string; price: string; minPrice?: string | null }[]
  }
  type BarcodeInput = { barcode: string; productUnitId?: string | null; isPrimary: boolean }

  const unitRowIds = new Map<string, string>()

  for (const raw of input.units as UnitInput[]) {
    const [row] = await tx
      .insert(productUnits)
      .values({
        tenantId,
        productId,
        unitId: raw.unitId,
        factor: raw.factor,
        isDefault: raw.isDefault,
      })
      // إعادة تفعيل صف محذوف ناعماً بدل خرق UNIQUE (product_id, unit_id)
      .onConflictDoUpdate({
        target: [productUnits.productId, productUnits.unitId],
        set: { factor: raw.factor, isDefault: raw.isDefault, deletedAt: null },
      })
      .returning({ id: productUnits.id })

    unitRowIds.set(raw.unitId, row!.id)

    for (const price of raw.prices ?? []) {
      await tx
        .insert(productPrices)
        .values({
          tenantId,
          productUnitId: row!.id,
          priceListId: price.priceListId,
          price: price.price,
          minPrice: price.minPrice ?? null,
        })
        .onConflictDoUpdate({
          target: [productPrices.productUnitId, productPrices.priceListId],
          set: { price: price.price, minPrice: price.minPrice ?? null },
        })
    }
  }

  for (const raw of input.barcodes as BarcodeInput[]) {
    await tx
      .insert(productBarcodes)
      .values({
        tenantId,
        productId,
        productUnitId: raw.productUnitId ?? null,
        barcode: raw.barcode,
        isPrimary: raw.isPrimary,
      })
      .onConflictDoUpdate({
        target: [productBarcodes.tenantId, productBarcodes.barcode],
        set: { productId, isPrimary: raw.isPrimary, deletedAt: null },
      })
  }
}

async function defaultPriceListId(db: Database, tenantId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: priceLists.id })
    .from(priceLists)
    .where(
      and(
        eq(priceLists.tenantId, tenantId),
        eq(priceLists.isDefault, true),
        isNull(priceLists.deletedAt)
      )
    )
    .limit(1)
  return row?.id ?? null
}

/** يجمع الصنف بوحداته وباركوداته وأسعاره — شكل `product` في @falak/contracts */
async function loadProduct(db: Database, tenantId: string, id: string) {
  const [product] = await db
    .select({
      id: products.id,
      categoryId: products.categoryId,
      categoryNameAr: categories.nameAr,
      baseUnitId: products.baseUnitId,
      taxId: products.taxId,
      sku: products.sku,
      nameAr: products.nameAr,
      nameEn: products.nameEn,
      productType: products.productType,
      trackExpiry: products.trackExpiry,
      trackBatches: products.trackBatches,
      isWeighed: products.isWeighed,
      pluCode: products.pluCode,
      costMethod: products.costMethod,
      minStock: products.minStock,
      reorderQty: products.reorderQty,
      manufacturer: products.manufacturer,
      imageUrl: products.imageUrl,
      isActive: products.isActive,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(eq(products.id, id), eq(products.tenantId, tenantId), isNull(products.deletedAt)))
    .limit(1)

  if (!product) return null

  const unitRows = await db
    .select({
      id: productUnits.id,
      unitId: productUnits.unitId,
      unitNameAr: units.nameAr,
      factor: productUnits.factor,
      isDefault: productUnits.isDefault,
    })
    .from(productUnits)
    .innerJoin(units, eq(units.id, productUnits.unitId))
    .where(and(eq(productUnits.productId, id), isNull(productUnits.deletedAt)))
    .orderBy(asc(productUnits.factor))

  const priceRows = await db
    .select({
      productUnitId: productPrices.productUnitId,
      priceListId: productPrices.priceListId,
      priceListName: priceLists.name,
      price: productPrices.price,
      minPrice: productPrices.minPrice,
    })
    .from(productPrices)
    .innerJoin(priceLists, eq(priceLists.id, productPrices.priceListId))
    .where(
      sql`${productPrices.productUnitId} IN (
        SELECT id FROM product_units WHERE product_id = ${id} AND deleted_at IS NULL)`
    )

  const barcodeRows = await db
    .select({
      id: productBarcodes.id,
      barcode: productBarcodes.barcode,
      productUnitId: productBarcodes.productUnitId,
      isPrimary: productBarcodes.isPrimary,
    })
    .from(productBarcodes)
    .where(and(eq(productBarcodes.productId, id), isNull(productBarcodes.deletedAt)))

  return {
    ...product,
    units: unitRows.map((unit) => ({
      ...unit,
      prices: priceRows
        .filter((price) => price.productUnitId === unit.id)
        .map(({ productUnitId: _unused, ...rest }) => rest),
    })),
    barcodes: barcodeRows,
  }
}
