import { randomUUID } from 'node:crypto'
import { importCommitRequest } from '@falak/contracts'
import type { ImportColumnMap, ImportRow, ImportRowResult } from '@falak/contracts'
import {
  categories,
  productBarcodes,
  productPrices,
  productUnits,
  products,
  units,
} from '@falak/db'
import type { Database } from '@falak/db'
import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import * as XLSX from 'xlsx'
import { PERMISSIONS } from '../auth/permissions.js'
import { recordAudit } from '../audit.js'

/**
 * استيراد الأصناف من Excel (المهمة 1.4).
 * التدفّق: رفع ⇒ معاينة (اكتشاف الأعمدة + أول 20 صفاً) ⇒ تنفيذ ⇒ **تقرير لكل صف**.
 *
 * التقرير لكل صف ليس ترفاً: العميل يصل بملف من برنامجه القديم فيه أخطاء، وأسوأ
 * ما يمكن فعله هو رفض الملف كله أو استيراده صامتاً بأخطاء. الوثيقة (04 · 1.7)
 * تطلب «استيراد Excel بمعاينة» و«تقرير أخطاء لكل صف».
 */

/** عدد صفوف المعاينة قبل التنفيذ */
const PREVIEW_ROWS = 20

/** الملفات المرفوعة تعيش في الذاكرة حتى التنفيذ — تُنظَّف بعد ساعة */
const UPLOAD_TTL_MS = 60 * 60 * 1000

interface StoredUpload {
  fileName: string
  rows: Record<string, unknown>[]
  headers: string[]
  storedAt: number
}

const uploads = new Map<string, StoredUpload>()

function pruneUploads(): void {
  const cutoff = Date.now() - UPLOAD_TTL_MS
  for (const [id, upload] of uploads) {
    if (upload.storedAt < cutoff) uploads.delete(id)
  }
}

/**
 * مرادفات كل عمود بالعربية والإنجليزية — ملفات العملاء تأتي بترويسات مختلفة،
 * والاكتشاف التلقائي هو ما يوفّر على أمين المخزن ربط الأعمدة يدوياً.
 */
const COLUMN_SYNONYMS: Record<keyof ImportColumnMap, string[]> = {
  nameAr: ['اسم الصنف', 'الصنف', 'الاسم', 'اسم المادة', 'البيان', 'name', 'product'],
  nameEn: ['الاسم بالإنجليزية', 'english name', 'name_en'],
  sku: ['الكود', 'كود الصنف', 'رقم الصنف', 'sku', 'code'],
  barcode: ['الباركود', 'باركود', 'رمز', 'barcode', 'ean'],
  categoryName: ['التصنيف', 'المجموعة', 'الفئة', 'category', 'group'],
  unitName: ['الوحدة', 'وحدة القياس', 'unit'],
  price: ['السعر', 'سعر البيع', 'price', 'sell price'],
  minPrice: ['أقل سعر', 'الحد الأدنى للسعر', 'min price'],
  cost: ['التكلفة', 'سعر الشراء', 'cost'],
  minStock: ['الحد الأدنى', 'حد الطلب', 'min stock'],
  manufacturer: ['المورد', 'اسم المورد', 'الشركة', 'المنتج', 'manufacturer', 'supplier'],
}

const normalize = (value: string): string =>
  value.trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/\s+/g, ' ')

/** يطابق ترويسات الملف بأعمدتنا. العمود غير الموجود يبقى `null`. */
function detectColumns(headers: string[]): ImportColumnMap {
  const map = {} as ImportColumnMap
  const normalized = headers.map((header) => ({ header, key: normalize(header) }))

  for (const [field, synonyms] of Object.entries(COLUMN_SYNONYMS) as [
    keyof ImportColumnMap,
    string[],
  ][]) {
    const wanted = synonyms.map(normalize)
    const found = normalized.find(
      (h) => wanted.includes(h.key) || wanted.some((w) => h.key.includes(w))
    )
    map[field] = found?.header ?? null
  }
  return map
}

const cell = (row: Record<string, unknown>, column: string | null): string | null => {
  if (!column) return null
  const value = row[column]
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  return text === '' ? null : text
}

function toImportRow(
  row: Record<string, unknown>,
  map: ImportColumnMap,
  rowNumber: number
): ImportRow {
  return {
    rowNumber,
    nameAr: cell(row, map.nameAr),
    nameEn: cell(row, map.nameEn),
    sku: cell(row, map.sku),
    barcode: cell(row, map.barcode),
    categoryName: cell(row, map.categoryName),
    unitName: cell(row, map.unitName),
    price: cell(row, map.price),
    minPrice: cell(row, map.minPrice),
    cost: cell(row, map.cost),
    minStock: cell(row, map.minStock),
    manufacturer: cell(row, map.manufacturer),
  }
}

/** صيغة المبلغ المقبولة — نفس قيد `numeric(14,2)` في القاعدة */
const MONEY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/
const BARCODE_PATTERN = /^\d{4,24}$/

/** الامتدادات التي نقبلها من شاشة الاستيراد */
const ACCEPTED_EXTENSIONS = ['.xlsx', '.xlsm', '.xls', '.csv']

/**
 * يتحقق أن الملف جدول فعلاً قبل تسليمه للمكتبة.
 *
 * `XLSX.read` متساهلة: تبتلع ملف نص عادي وتعيد «جدولاً» من سطر واحد بلا خطأ،
 * فيظنّ المستخدم أن ملفه استُورد. الرفض هنا أوضح من استيراد بلا معنى.
 * ملفات xlsx أرشيف ZIP فتبدأ دائماً بـ `PK`.
 */
function rejectIfNotSpreadsheet(fileName: string, buffer: Buffer): string | null {
  const lower = fileName.toLowerCase()
  const extension = ACCEPTED_EXTENSIONS.find((ext) => lower.endsWith(ext))

  if (!extension) {
    return 'الملف ليس جدولاً. اختر ملف Excel بامتداد xlsx أو xls أو csv.'
  }
  if (extension !== '.csv' && !(buffer[0] === 0x50 && buffer[1] === 0x4b)) {
    return 'الملف امتداده Excel لكن محتواه ليس كذلك. صدّره من Excel بصيغة xlsx وأعد المحاولة.'
  }
  return null
}

export async function importRoutes(app: FastifyInstance): Promise<void> {
  /* ── رفع ومعاينة ───────────────────────────────────────────────────────── */
  app.post(
    '/preview',
    { onRequest: app.requirePermission(PERMISSIONS.PRODUCTS_IMPORT) },
    async (request, reply) => {
      const file = await request.file()
      if (!file) {
        return reply
          .code(400)
          .send({ error: { code: 'no_file', message: 'اختر ملف Excel أولاً.' } })
      }

      const buffer = await file.toBuffer()

      const rejection = rejectIfNotSpreadsheet(file.filename, buffer)
      if (rejection) {
        return reply.code(400).send({ error: { code: 'unreadable_file', message: rejection } })
      }

      let rows: Record<string, unknown>[]
      let headers: string[]

      try {
        const book = XLSX.read(buffer, { type: 'buffer' })
        const sheetName = book.SheetNames[0]
        const sheet = sheetName ? book.Sheets[sheetName] : undefined
        if (!sheet) throw new Error('لا ورقة عمل')

        rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null })
        const headerRow = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })[0] ?? []
        headers = headerRow.map((h) => String(h ?? '').trim()).filter(Boolean)
      } catch {
        return reply.code(400).send({
          error: {
            code: 'unreadable_file',
            message: 'تعذّرت قراءة الملف. تأكد أنه Excel (xlsx) وأن الورقة الأولى فيها البيانات.',
          },
        })
      }

      const detectedColumns = detectColumns(headers)
      const warnings: string[] = []
      if (!detectedColumns.nameAr) {
        warnings.push('لم نجد عمود اسم الصنف. اختره يدوياً قبل التنفيذ.')
      }
      if (!detectedColumns.price) {
        warnings.push('لم نجد عمود السعر. ستُستورد الأصناف بلا أسعار.')
      }
      if (rows.length === 0) {
        warnings.push('الملف لا يحتوي صفوفاً.')
      }

      pruneUploads()
      const uploadId = randomUUID()
      uploads.set(uploadId, {
        fileName: file.filename,
        rows,
        headers,
        storedAt: Date.now(),
      })

      return {
        uploadId,
        fileName: file.filename,
        totalRows: rows.length,
        detectedColumns,
        headers,
        // رقم الصف يبدأ من 2 لأن الصف 1 هو الترويسة في ملف المستخدم
        sample: rows
          .slice(0, PREVIEW_ROWS)
          .map((row, index) => toImportRow(row, detectedColumns, index + 2)),
        warnings,
      }
    }
  )

  /* ── التنفيذ ───────────────────────────────────────────────────────────── */
  app.post(
    '/commit',
    { onRequest: app.requirePermission(PERMISSIONS.PRODUCTS_IMPORT) },
    async (request, reply) => {
      const parsed = importCommitRequest.safeParse(request.body)
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: { code: 'invalid_input', message: 'بيانات الاستيراد غير صالحة.' } })
      }

      const upload = uploads.get(parsed.data.uploadId)
      if (!upload) {
        return reply.code(404).send({
          error: {
            code: 'upload_expired',
            message: 'انتهت صلاحية الملف المرفوع. ارفعه مرة أخرى.',
          },
        })
      }

      const tenantId = request.session!.tenantId
      const context = { tenantId, userId: request.session!.sub }
      const map = parsed.data.columnMap ?? detectColumns(upload.headers)
      const started = Date.now()

      const categoryIds = await nameIndex(app.db, tenantId, 'categories')
      const unitIds = await nameIndex(app.db, tenantId, 'units')

      const results: ImportRowResult[] = []

      for (const [index, raw] of upload.rows.entries()) {
        const row = toImportRow(raw, map, index + 2)
        results.push(
          await importOneRow(app.db, {
            row,
            tenantId,
            context,
            categoryIds,
            unitIds,
            options: parsed.data,
          })
        )
      }

      uploads.delete(parsed.data.uploadId)

      const tally = (status: ImportRowResult['status']) =>
        results.filter((r) => r.status === status).length

      return {
        created: tally('created'),
        updated: tally('updated'),
        skipped: tally('skipped'),
        failed: tally('failed'),
        durationMs: Date.now() - started,
        rows: results,
      }
    }
  )
}

/** خريطة الاسم ← المعرّف للتصنيفات أو الوحدات، لمطابقة ما في الملف */
async function nameIndex(
  db: Database,
  tenantId: string,
  table: 'categories' | 'units'
): Promise<Map<string, string>> {
  const rows =
    table === 'categories'
      ? await db
          .select({ id: categories.id, name: categories.nameAr })
          .from(categories)
          .where(and(eq(categories.tenantId, tenantId), isNull(categories.deletedAt)))
      : await db
          .select({ id: units.id, name: units.nameAr })
          .from(units)
          .where(and(eq(units.tenantId, tenantId), isNull(units.deletedAt)))

  return new Map(rows.map((row) => [normalize(row.name), row.id]))
}

interface ImportRowContext {
  row: ImportRow
  tenantId: string
  context: { tenantId: string; userId: string }
  categoryIds: Map<string, string>
  unitIds: Map<string, string>
  options: {
    priceListId: string
    defaultCategoryId?: string | null
    defaultUnitId: string
    onDuplicate: 'skip' | 'update'
  }
}

/**
 * يستورد صفاً واحداً في معاملته المستقلة.
 *
 * **قرار:** كل صف معاملة على حدة، فصفٌّ خاطئ لا يُسقط الملف كله. المستخدم يريد
 * أن تدخل الـ497 صفاً الصحيحة ويعرف الثلاثة الخاطئة بأسمائها، لا أن يخسر كل شيء.
 */
async function importOneRow(db: Database, ctx: ImportRowContext): Promise<ImportRowResult> {
  const { row, tenantId, options } = ctx
  const base = { rowNumber: row.rowNumber, productId: null, nameAr: row.nameAr }

  if (!row.nameAr) {
    return { ...base, status: 'failed', message: 'اسم الصنف فارغ.' }
  }
  if (row.barcode && !BARCODE_PATTERN.test(row.barcode)) {
    return {
      ...base,
      status: 'failed',
      message: `الباركود «${row.barcode}» غير صالح — أرقام فقط بين 4 و24 خانة.`,
    }
  }
  if (row.price && !MONEY_PATTERN.test(row.price)) {
    return { ...base, status: 'failed', message: `السعر «${row.price}» ليس رقماً.` }
  }

  const categoryId = row.categoryName
    ? (ctx.categoryIds.get(normalize(row.categoryName)) ?? options.defaultCategoryId ?? null)
    : (options.defaultCategoryId ?? null)
  const unitId = row.unitName
    ? (ctx.unitIds.get(normalize(row.unitName)) ?? options.defaultUnitId)
    : options.defaultUnitId

  try {
    return await db.transaction(async (tx) => {
      // الباركود الموجود يحسم: تحديث أم تخطٍّ (القاعدة 1: `deleted_at IS NULL`)
      if (row.barcode) {
        const [existing] = await tx
          .select({ productId: productBarcodes.productId })
          .from(productBarcodes)
          .where(
            and(
              eq(productBarcodes.tenantId, tenantId),
              eq(productBarcodes.barcode, row.barcode),
              isNull(productBarcodes.deletedAt)
            )
          )
          .limit(1)

        if (existing) {
          if (options.onDuplicate === 'skip') {
            return {
              ...base,
              status: 'skipped' as const,
              productId: existing.productId,
              message: 'الباركود مستخدم في صنف موجود.',
            }
          }

          const [updated] = await tx
            .update(products)
            .set({
              nameAr: row.nameAr!,
              nameEn: row.nameEn,
              categoryId,
              manufacturer: row.manufacturer,
              minStock: row.minStock ?? '0',
            })
            .where(eq(products.id, existing.productId))
            .returning()

          await recordAudit(tx, ctx.context, {
            action: 'product.imported_update',
            entity: 'products',
            entityId: existing.productId,
            after: updated,
          })

          return {
            ...base,
            status: 'updated' as const,
            productId: existing.productId,
            message: null,
          }
        }
      }

      const [product] = await tx
        .insert(products)
        .values({
          tenantId,
          categoryId,
          baseUnitId: unitId,
          sku: row.sku,
          nameAr: row.nameAr!,
          nameEn: row.nameEn,
          manufacturer: row.manufacturer,
          minStock: row.minStock ?? '0',
        })
        .returning()

      const [unitRow] = await tx
        .insert(productUnits)
        .values({ tenantId, productId: product!.id, unitId, factor: '1.000', isDefault: true })
        .returning({ id: productUnits.id })

      if (row.price) {
        await tx.insert(productPrices).values({
          tenantId,
          productUnitId: unitRow!.id,
          priceListId: options.priceListId,
          price: row.price,
          minPrice: row.minPrice && MONEY_PATTERN.test(row.minPrice) ? row.minPrice : null,
        })
      }

      if (row.barcode) {
        await tx.insert(productBarcodes).values({
          tenantId,
          productId: product!.id,
          barcode: row.barcode,
          isPrimary: true,
        })
      }

      await recordAudit(tx, ctx.context, {
        action: 'product.imported',
        entity: 'products',
        entityId: product!.id,
        after: product,
      })

      return { ...base, status: 'created' as const, productId: product!.id, message: null }
    })
  } catch (error) {
    const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code
    if (code === '23505') {
      return { ...base, status: 'failed', message: 'الباركود مكرر داخل الملف نفسه.' }
    }
    return {
      ...base,
      status: 'failed',
      message: `تعذّر الحفظ: ${(error as Error).message}`,
    }
  }
}
