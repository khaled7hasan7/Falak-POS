import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auditLogs, connect, syncOutbox } from '@falak/db'
import { seed } from '@falak/db/scripts/seed'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import {
  auth,
  agentTestDatabaseUrl,
  createTestApp,
  loginWithPassword,
  type LoggedIn,
} from './helpers.js'

/**
 * الأصناف والاستيراد وقياس بحث الباركود.
 * المرجع: `docs/02-database.md §5.1` و`docs/04-execution-plan.md` معيار إنجاز M1.
 */

/** الحد الذي تفرضه الوثيقة: بحث الباركود أقل من 100ms على الجهاز الضعيف */
const BARCODE_BUDGET_MS = 100

let app: FastifyInstance
let closeApp: () => Promise<void>
let owner: LoggedIn
let priceListId: string
let unitId: string
let categoryId: string

beforeAll(async () => {
  const test = await createTestApp()
  app = test.app
  closeApp = test.close

  const connection = connect(await agentTestDatabaseUrl())
  try {
    await seed(connection.db)
  } finally {
    await connection.close()
  }

  owner = await loginWithPassword(app, 'khaled', process.env.SEED_OWNER_PASSWORD ?? 'falak123')

  const lists = await app.inject({
    method: 'GET',
    url: '/api/price-lists',
    headers: auth(owner.token),
  })
  priceListId = lists.json<{ rows: { id: string }[] }>().rows[0]!.id

  const units = await app.inject({ method: 'GET', url: '/api/units', headers: auth(owner.token) })
  unitId = units.json<{ rows: { id: string }[] }>().rows[0]!.id

  const cats = await app.inject({
    method: 'GET',
    url: '/api/categories',
    headers: auth(owner.token),
  })
  categoryId = cats.json<{ rows: { id: string }[] }>().rows[0]!.id
}, 180_000)

afterAll(async () => {
  await closeApp()
})

describe('قائمة الأصناف', () => {
  it('البذرة تعطي 500 صنف مصفَّحة 50 في الصفحة', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/products',
      headers: auth(owner.token),
    })
    expect(response.statusCode).toBe(200)

    const body = response.json<{ rows: unknown[]; total: number; perPage: number }>()
    expect(body.total).toBe(500)
    expect(body.rows).toHaveLength(50)
    expect(body.perPage).toBe(50)
  })

  it('التصفية بالتصنيف تقلّص النتيجة', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/products?categoryId=${categoryId}`,
      headers: auth(owner.token),
    })
    const body = response.json<{ total: number }>()
    expect(body.total).toBeGreaterThan(0)
    expect(body.total).toBeLessThan(500)
  })

  it('البحث بالاسم يجد الأصناف', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/products?q=' + encodeURIComponent('حليب'),
      headers: auth(owner.token),
    })
    const body = response.json<{ rows: { nameAr: string }[]; total: number }>()
    expect(body.total).toBeGreaterThan(0)
    expect(body.rows[0]!.nameAr).toContain('حليب')
  })
})

describe('بحث الباركود — المسار الأسرع في النظام', () => {
  async function anyBarcode(): Promise<string> {
    const { rows } = await app.pool.query<{ barcode: string }>(
      'SELECT barcode FROM product_barcodes WHERE deleted_at IS NULL LIMIT 1'
    )
    return rows[0]!.barcode
  }

  it('يجد الصنف ويعيد وحدته وسعره', async () => {
    const barcode = await anyBarcode()
    const response = await app.inject({
      method: 'GET',
      url: `/api/products/barcode/${barcode}`,
      headers: auth(owner.token),
    })

    expect(response.statusCode).toBe(200)
    const body = response.json<{
      productId: string
      nameAr: string
      productUnitId: string
      factor: string
      price: string | null
      scannedBarcode: string
    }>()
    expect(body.productId).toBeTruthy()
    expect(body.nameAr).toBeTruthy()
    expect(body.factor).toBeTruthy()
    expect(body.scannedBarcode).toBe(barcode)
    // المال يعبر نصاً لا رقماً (ADR-002)
    if (body.price !== null) expect(typeof body.price).toBe('string')
  })

  it('باركود غير موجود يعيد 404 برسالة تقول ما العمل', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/products/barcode/9999999999999',
      headers: auth(owner.token),
    })
    expect(response.statusCode).toBe(404)
    expect(response.json<{ error: { message: string } }>().error.message).toContain('ابحث بالاسم')
  })

  it(`يرد في أقل من ${BARCODE_BUDGET_MS}ms على 500 صنف (معيار إنجاز M1)`, async () => {
    const barcode = await anyBarcode()

    // إحماء: أول استعلام يبني الخطة ويسخّن الكاش
    await app.inject({
      method: 'GET',
      url: `/api/products/barcode/${barcode}`,
      headers: auth(owner.token),
    })

    const samples: number[] = []
    for (let i = 0; i < 20; i++) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/products/barcode/${barcode}`,
        headers: auth(owner.token),
      })
      samples.push(response.json<{ elapsedMs: number }>().elapsedMs)
    }

    samples.sort((a, b) => a - b)
    const median = samples[Math.floor(samples.length / 2)]!
    const worst = samples[samples.length - 1]!

    // القياس مطبوع كما تطلب الوثيقة — لا يكفي أن ينجح، يجب أن يُرى الرقم
    console.log(
      `[قياس] بحث الباركود على 500 صنف: الوسيط ${median.toFixed(2)}ms · ` +
        `الأسوأ ${worst.toFixed(2)}ms · الحد ${BARCODE_BUDGET_MS}ms`
    )

    expect(median).toBeLessThan(BARCODE_BUDGET_MS)
    expect(worst).toBeLessThan(BARCODE_BUDGET_MS)
  })
})

describe('إنشاء وتعديل وحذف صنف', () => {
  const payload = () => ({
    nameAr: 'صنف من الاختبار',
    baseUnitId: unitId,
    categoryId,
    units: [
      { unitId, factor: '1.000', isDefault: true, prices: [{ priceListId, price: '12.50' }] },
    ],
    barcodes: [{ barcode: '6251111111119', isPrimary: true }],
  })

  it('ينشئ صنفاً كاملاً بوحدته وسعره وباركوده، ثم يُجلب بالباركود', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/products',
      headers: auth(owner.token),
      payload: payload(),
    })
    expect(created.statusCode).toBe(201)

    const product = created.json<{
      id: string
      nameAr: string
      units: { factor: string; prices: { price: string }[] }[]
      barcodes: { barcode: string }[]
    }>()
    expect(product.nameAr).toBe('صنف من الاختبار')
    expect(product.units[0]!.prices[0]!.price).toBe('12.50')
    expect(product.barcodes[0]!.barcode).toBe('6251111111119')

    const found = await app.inject({
      method: 'GET',
      url: '/api/products/barcode/6251111111119',
      headers: auth(owner.token),
    })
    expect(found.statusCode).toBe(200)
    expect(found.json<{ productId: string }>().productId).toBe(product.id)
  })

  it('كل كتابة تنتج صف audit_logs وصف sync_outbox في نفس المعاملة (القاعدة 4)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/products',
      headers: auth(owner.token),
      payload: { ...payload(), nameAr: 'صنف للتدقيق', barcodes: [] },
    })
    const productId = created.json<{ id: string }>().id

    const audits = await app.db.select().from(auditLogs).where(eq(auditLogs.entityId, productId))
    expect(audits).toHaveLength(1)
    expect(audits[0]!.action).toBe('product.created')
    expect(audits[0]!.userId).toBe(owner.userId)

    const outbox = await app.db.select().from(syncOutbox).where(eq(syncOutbox.rowId, productId))
    expect(outbox).toHaveLength(1)
    expect(outbox[0]!.op).toBe('insert')
    expect(outbox[0]!.tableName).toBe('products')
    expect(outbox[0]!.syncedAt).toBeNull()
  })

  it('الاسم الفارغ يُرفض 400 برسالة عربية', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/products',
      headers: auth(owner.token),
      payload: { ...payload(), nameAr: '' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json<{ error: { message: string } }>().error.message).toContain('اسم الصنف')
  })

  it('وحدتان افتراضيتان تُرفضان', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/products',
      headers: auth(owner.token),
      payload: {
        ...payload(),
        barcodes: [],
        units: [
          { unitId, factor: '1.000', isDefault: true, prices: [] },
          { unitId, factor: '12.000', isDefault: true, prices: [] },
        ],
      },
    })
    expect(response.statusCode).toBe(400)
  })

  it('صنف موزون بلا كود ميزان يُرفض', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/products',
      headers: auth(owner.token),
      payload: { ...payload(), barcodes: [], isWeighed: true, pluCode: null },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json<{ error: { message: string } }>().error.message).toContain('كود ميزان')
  })

  it('الحذف ناعم: يختفي من القائمة ويبقى الصف في القاعدة (القاعدة 1)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/products',
      headers: auth(owner.token),
      payload: { ...payload(), nameAr: 'صنف للحذف', barcodes: [] },
    })
    const productId = created.json<{ id: string }>().id

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/products/${productId}`,
      headers: auth(owner.token),
    })
    expect(deleted.statusCode).toBe(204)

    const fetched = await app.inject({
      method: 'GET',
      url: `/api/products/${productId}`,
      headers: auth(owner.token),
    })
    expect(fetched.statusCode).toBe(404)

    // الصف ما زال موجوداً — لا DELETE فعلي
    const { rows } = await app.pool.query('SELECT deleted_at FROM products WHERE id = $1', [
      productId,
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.deleted_at).not.toBeNull()
  })

  it('صنف غير موجود يعيد 404', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/products/00000000-0000-4000-8000-000000000000',
      headers: auth(owner.token),
    })
    expect(response.statusCode).toBe(404)
  })
})

describe('استيراد Excel — 500 صنف بتقرير لكل صف', () => {
  const FIXTURE = resolve(process.cwd(), '../../packages/db/src/seed/data/products.xlsx')

  /** يبني جسم multipart يدوياً — أبسط من إضافة تبعية لأجل اختبار واحد */
  function multipartBody(fileName: string, content: Buffer) {
    const boundary = '----falakTestBoundary'
    const head = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
        `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`
    )
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
    return {
      payload: Buffer.concat([head, content, tail]),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    }
  }

  it('المعاينة تكتشف الأعمدة العربية وتعيد 20 صفاً', async () => {
    const file = readFileSync(FIXTURE)
    const { payload, headers } = multipartBody('products.xlsx', file)

    const response = await app.inject({
      method: 'POST',
      url: '/api/import/preview',
      headers: { ...headers, ...auth(owner.token) },
      payload,
    })

    expect(response.statusCode).toBe(200)
    const body = response.json<{
      uploadId: string
      totalRows: number
      detectedColumns: Record<string, string | null>
      sample: unknown[]
    }>()

    expect(body.totalRows).toBe(503) // 500 صالح + 3 خاطئة عمداً
    expect(body.sample).toHaveLength(20)
    expect(body.detectedColumns.nameAr).toBe('اسم الصنف')
    expect(body.detectedColumns.barcode).toBe('الباركود')
    expect(body.detectedColumns.price).toBe('السعر')
    expect(body.uploadId).toBeTruthy()
  })

  it('التنفيذ يستورد الصفوف الصالحة ويشرح الخاطئة صفاً صفاً', async () => {
    const file = readFileSync(FIXTURE)
    const { payload, headers } = multipartBody('products.xlsx', file)

    const preview = await app.inject({
      method: 'POST',
      url: '/api/import/preview',
      headers: { ...headers, ...auth(owner.token) },
      payload,
    })
    const uploadId = preview.json<{ uploadId: string }>().uploadId

    const commit = await app.inject({
      method: 'POST',
      url: '/api/import/commit',
      headers: auth(owner.token),
      payload: {
        uploadId,
        priceListId,
        defaultUnitId: unitId,
        defaultCategoryId: categoryId,
        onDuplicate: 'skip',
      },
    })

    expect(commit.statusCode).toBe(200)
    const report = commit.json<{
      created: number
      skipped: number
      failed: number
      durationMs: number
      rows: { rowNumber: number; status: string; message: string | null }[]
    }>()

    console.log(
      `[قياس] استيراد ${report.rows.length} صف في ${report.durationMs}ms — ` +
        `أُضيف ${report.created} · تُخطّي ${report.skipped} · فشل ${report.failed}`
    )

    // الـ500 صف موجودة أصلاً بباركوداتها من البذرة ⇒ تُتخطّى، والثلاثة الخاطئة تفشل
    expect(report.skipped).toBe(500)
    expect(report.failed).toBe(3)
    expect(report.rows).toHaveLength(503)

    // كل صف فاشل يحمل رسالة تشرح السبب
    const failures = report.rows.filter((row) => row.status === 'failed')
    expect(failures).toHaveLength(3)
    for (const failure of failures) {
      expect(failure.message).toBeTruthy()
      expect(failure.rowNumber).toBeGreaterThan(0)
    }
    expect(failures.map((f) => f.message).join(' ')).toMatch(/اسم الصنف فارغ/)
    expect(failures.map((f) => f.message).join(' ')).toMatch(/ليس رقماً/)
    expect(failures.map((f) => f.message).join(' ')).toMatch(/غير صالح/)
  })

  it('ملف ليس جدولاً يُرفض برسالة تقول ما المطلوب', async () => {
    const { payload, headers } = multipartBody('notes.txt', Buffer.from('هذا ليس ملف إكسل'))

    const response = await app.inject({
      method: 'POST',
      url: '/api/import/preview',
      headers: { ...headers, ...auth(owner.token) },
      payload,
    })
    expect(response.statusCode).toBe(400)
    expect(response.json<{ error: { message: string } }>().error.message).toContain('xlsx')
  })

  it('ملف امتداده xlsx ومحتواه ليس كذلك يُرفض (لا يُبتلع صامتاً)', async () => {
    // XLSX.read متساهلة وتقبل النص كجدول من سطر واحد — الفحص يمنع ذلك
    const { payload, headers } = multipartBody('fake.xlsx', Buffer.from('اسم الصنف,السعر\nخبز,3'))

    const response = await app.inject({
      method: 'POST',
      url: '/api/import/preview',
      headers: { ...headers, ...auth(owner.token) },
      payload,
    })
    expect(response.statusCode).toBe(400)
    expect(response.json<{ error: { message: string } }>().error.message).toContain(
      'محتواه ليس كذلك'
    )
  })

  it('معرّف رفع منتهٍ يعيد 404 برسالة واضحة', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/import/commit',
      headers: auth(owner.token),
      payload: {
        uploadId: '00000000-0000-4000-8000-000000000000',
        priceListId,
        defaultUnitId: unitId,
      },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json<{ error: { message: string } }>().error.message).toContain(
      'ارفعه مرة أخرى'
    )
  })
})
