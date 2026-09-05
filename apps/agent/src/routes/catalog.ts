import { categoryInput, unitInput } from '@falak/contracts'
import { categories, priceLists, taxes, units } from '@falak/db'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { PERMISSIONS } from '../auth/permissions.js'
import { withAudit } from '../audit.js'

/**
 * التصنيفات ووحدات القياس وقوائم الأسعار والضرائب.
 * كلها كيانات مرجعية للأصناف، وصلاحياتها تتبع صلاحيات الأصناف (`docs/01 §6`).
 */

export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  const tenantOf = (request: { session?: { tenantId: string } }) => request.session!.tenantId
  const contextOf = (request: { session?: { tenantId: string; sub: string } }) => ({
    tenantId: request.session!.tenantId,
    userId: request.session!.sub,
  })

  const view = { onRequest: app.requirePermission(PERMISSIONS.PRODUCTS_VIEW) }
  const edit = { onRequest: app.requirePermission(PERMISSIONS.PRODUCTS_EDIT) }

  /* ── التصنيفات ─────────────────────────────────────────────────────────── */
  app.get('/categories', view, async (request) => {
    const rows = await app.db
      .select({
        id: categories.id,
        parentId: categories.parentId,
        nameAr: categories.nameAr,
        nameEn: categories.nameEn,
        color: categories.color,
        sortOrder: categories.sortOrder,
      })
      .from(categories)
      .where(and(eq(categories.tenantId, tenantOf(request)), isNull(categories.deletedAt)))
      .orderBy(asc(categories.sortOrder), asc(categories.nameAr))

    return { rows }
  })

  app.post('/categories', edit, async (request, reply) => {
    const parsed = categoryInput.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'invalid_input',
          message: parsed.error.issues[0]?.message ?? 'بيانات التصنيف غير صالحة.',
        },
      })
    }

    const created = await withAudit(app.db, contextOf(request), async (tx) => {
      const [row] = await tx
        .insert(categories)
        .values({
          tenantId: tenantOf(request),
          parentId: parsed.data.parentId ?? null,
          nameAr: parsed.data.nameAr,
          nameEn: parsed.data.nameEn ?? null,
          color: parsed.data.color ?? null,
          sortOrder: parsed.data.sortOrder ?? 0,
        })
        .returning()

      return {
        result: row!,
        entry: {
          action: 'category.created',
          entity: 'categories',
          entityId: row!.id,
          after: row,
        },
      }
    })

    return reply.code(201).send(created)
  })

  app.put<{ Params: { id: string } }>('/categories/:id', edit, async (request, reply) => {
    const parsed = categoryInput.safeParse(request.body)
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: { code: 'invalid_input', message: 'بيانات التصنيف غير صالحة.' } })
    }

    const tenantId = tenantOf(request)
    const [existing] = await app.db
      .select()
      .from(categories)
      .where(
        and(
          eq(categories.id, request.params.id),
          eq(categories.tenantId, tenantId),
          isNull(categories.deletedAt)
        )
      )
      .limit(1)

    if (!existing) {
      return reply
        .code(404)
        .send({ error: { code: 'not_found', message: 'غير موجود — ربما حُذف.' } })
    }

    return withAudit(app.db, contextOf(request), async (tx) => {
      const [row] = await tx
        .update(categories)
        .set({
          parentId: parsed.data.parentId ?? null,
          nameAr: parsed.data.nameAr,
          nameEn: parsed.data.nameEn ?? null,
          color: parsed.data.color ?? null,
          sortOrder: parsed.data.sortOrder ?? existing.sortOrder,
        })
        .where(eq(categories.id, existing.id))
        .returning()

      return {
        result: row!,
        entry: {
          action: 'category.updated',
          entity: 'categories',
          entityId: existing.id,
          before: existing,
          after: row,
        },
      }
    })
  })

  /* ── وحدات القياس ──────────────────────────────────────────────────────── */
  app.get('/units', view, async (request) => {
    const rows = await app.db
      .select({
        id: units.id,
        nameAr: units.nameAr,
        nameEn: units.nameEn,
        symbol: units.symbol,
        allowFraction: units.allowFraction,
      })
      .from(units)
      .where(and(eq(units.tenantId, tenantOf(request)), isNull(units.deletedAt)))
      .orderBy(asc(units.nameAr))

    return { rows }
  })

  app.post('/units', edit, async (request, reply) => {
    const parsed = unitInput.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'invalid_input',
          message: parsed.error.issues[0]?.message ?? 'بيانات الوحدة غير صالحة.',
        },
      })
    }

    const created = await withAudit(app.db, contextOf(request), async (tx) => {
      const [row] = await tx
        .insert(units)
        .values({
          tenantId: tenantOf(request),
          nameAr: parsed.data.nameAr,
          nameEn: parsed.data.nameEn ?? null,
          symbol: parsed.data.symbol ?? null,
          allowFraction: parsed.data.allowFraction,
        })
        .returning()

      return {
        result: row!,
        entry: { action: 'unit.created', entity: 'units', entityId: row!.id, after: row },
      }
    })

    return reply.code(201).send(created)
  })

  /* ── قوائم الأسعار والضرائب (قراءة — إدارتها في M3 مع شاشة الإعدادات) ──── */
  app.get('/price-lists', view, async (request) => {
    const rows = await app.db
      .select({
        id: priceLists.id,
        name: priceLists.name,
        currencyCode: priceLists.currencyCode,
        isDefault: priceLists.isDefault,
      })
      .from(priceLists)
      .where(and(eq(priceLists.tenantId, tenantOf(request)), isNull(priceLists.deletedAt)))
      .orderBy(asc(priceLists.name))

    return { rows }
  })

  app.get('/taxes', view, async (request) => {
    const rows = await app.db
      .select({
        id: taxes.id,
        name: taxes.name,
        rate: taxes.rate,
        isInclusive: taxes.isInclusive,
        isDefault: taxes.isDefault,
      })
      .from(taxes)
      .where(and(eq(taxes.tenantId, tenantOf(request)), isNull(taxes.deletedAt)))
      .orderBy(asc(taxes.name))

    return { rows }
  })
}
