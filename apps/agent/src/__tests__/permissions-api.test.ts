import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connect } from '@falak/db'
import type { FastifyInstance } from 'fastify'
import { seed } from '@falak/db/scripts/seed'
import {
  auth,
  agentTestDatabaseUrl,
  createTestApp,
  loginWithPassword,
  loginWithPin,
  type LoggedIn,
} from './helpers.js'
import { can, permissionLimit, withinLimit } from '../auth/permissions.js'

/**
 * فحص الصلاحيات في الخادم — **القاعدة 6**: الواجهة تخفي، والخادم يرفض 403.
 * المرجع: `docs/01-project-and-permissions.md §6`.
 */

let app: FastifyInstance
let closeApp: () => Promise<void>
let owner: LoggedIn
let cashier: LoggedIn
let priceListId: string
let unitId: string
let categoryId: string

beforeAll(async () => {
  const test = await createTestApp()
  app = test.app
  closeApp = test.close

  // بذرة كاملة: نفس بيانات التطوير، فالاختبار يقيس ما سيراه العميل
  const connection = connect(await agentTestDatabaseUrl())
  try {
    await seed(connection.db)
  } finally {
    await connection.close()
  }

  owner = await loginWithPassword(app, 'khaled', process.env.SEED_OWNER_PASSWORD ?? 'falak123')

  const pinUsers = await app.inject({ method: 'GET', url: '/api/auth/pin-users' })
  const cashierId = pinUsers.json<{ users: { id: string; fullName: string }[] }>().users[0]!.id
  cashier = await loginWithPin(app, cashierId, '1234')

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
}, 120_000)

afterAll(async () => {
  await closeApp()
})

/** صنف صالح كامل — يُستعمل في اختبارات الإنشاء والتعديل */
function productPayload(overrides: Record<string, unknown> = {}) {
  return {
    nameAr: 'صنف اختبار',
    baseUnitId: unitId,
    categoryId,
    units: [{ unitId, factor: '1.000', isDefault: true, prices: [] }],
    barcodes: [],
    ...overrides,
  }
}

describe('دالة can — صيغة الصلاحية وحدودها', () => {
  it('تطابق الاسم المجرّد', () => {
    expect(can(['products.view'], 'products.view')).toBe(true)
    expect(can(['products.view'], 'products.edit')).toBe(false)
  })

  it('الصلاحية بلا حد تغطّي أي حد مطلوب', () => {
    expect(can(['pos.discount_line'], 'pos.discount_line:10')).toBe(true)
    expect(can(['pos.discount_line'], 'pos.discount_line:100')).toBe(true)
  })

  it('الصلاحية المحدودة لا تعطي الصلاحية المطلقة', () => {
    // هذه بالضبط حالة الكاشير: يخصم حتى 10% ولا يخصم بلا حد
    expect(can(['pos.discount_line:10'], 'pos.discount_line')).toBe(false)
  })

  it('الحد الأوسع يغطّي الأضيق لا العكس', () => {
    expect(can(['pos.discount_line:10'], 'pos.discount_line:5')).toBe(true)
    expect(can(['pos.discount_line:5'], 'pos.discount_line:10')).toBe(false)
  })

  it('permissionLimit وwithinLimit يقرآن الحد الرقمي', () => {
    expect(permissionLimit(['pos.discount_line:10'], 'pos.discount_line')).toBe(10)
    expect(permissionLimit(['pos.discount_line'], 'pos.discount_line')).toBe(Infinity)
    expect(permissionLimit([], 'pos.discount_line')).toBeNull()

    expect(withinLimit(['pos.discount_line:10'], 'pos.discount_line', 8)).toBe(true)
    expect(withinLimit(['pos.discount_line:10'], 'pos.discount_line', 12)).toBe(false)
  })
})

describe('المصادقة', () => {
  it('دخول صحيح يعيد جلسة وصلاحيات الدور', () => {
    expect(owner.token).toBeTruthy()
    expect(owner.permissions).toContain('products.edit_price')
  })

  it('كلمة مرور خاطئة تُرفض 401 برسالة لا تكشف أيّهما خطأ', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'khaled', password: 'wrong-password' },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json<{ error: { message: string } }>().error.message).toContain(
      'اسم المستخدم أو كلمة المرور'
    )
  })

  it('مستخدم غير موجود يُرفض بنفس الرسالة (لا تسريب بالتعداد)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ghost', password: 'whatever' },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json<{ error: { message: string } }>().error.message).toContain(
      'اسم المستخدم أو كلمة المرور'
    )
  })

  it('PIN خاطئ يُرفض 401', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/pin',
      payload: { userId: cashier.userId, pin: '9999' },
    })
    expect(response.statusCode).toBe(401)
  })

  it('طلب بلا جلسة يُرفض 401 لا 403', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/products' })
    expect(response.statusCode).toBe(401)
  })

  it('رمز مزوّر يُرفض', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/products',
      headers: auth('not.a.real.token'),
    })
    expect(response.statusCode).toBe(401)
  })
})

describe('رفض الصلاحيات في الخادم (403)', () => {
  it('الكاشير يقرأ الأصناف', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/products',
      headers: auth(cashier.token),
    })
    expect(response.statusCode).toBe(200)
  })

  it('الكاشير لا ينشئ صنفاً — لا يملك products.create', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/products',
      headers: auth(cashier.token),
      payload: productPayload(),
    })
    expect(response.statusCode).toBe(403)
    expect(response.json<{ error: { message: string } }>().error.message).toContain(
      'لا تملك صلاحية'
    )
  })

  it('الكاشير لا يحذف صنفاً', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/products?perPage=1',
      headers: auth(cashier.token),
    })
    const id = list.json<{ rows: { id: string }[] }>().rows[0]!.id

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/products/${id}`,
      headers: auth(cashier.token),
    })
    expect(response.statusCode).toBe(403)
  })

  it('الكاشير لا يستورد من Excel', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/import/commit',
      headers: auth(cashier.token),
      payload: {
        uploadId: '00000000-0000-4000-8000-000000000000',
        priceListId,
        defaultUnitId: unitId,
      },
    })
    expect(response.statusCode).toBe(403)
  })

  /**
   * الثغرة الشائعة: تُفحص `products.edit_price` في مسار السعر وتُنسى في مسار
   * تعديل الصنف الذي يقبل أسعاراً ضمن جسمه. المالك يملك الصلاحية والكاشير لا،
   * فلو مرّ هذا الطلب لاستطاع الكاشير تغيير الأسعار من شاشة الصنف العادية.
   */
  it('الكاشير لا يعدّل سعراً عبر مسار تعديل الصنف العادي', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/products',
      headers: auth(owner.token),
      payload: productPayload({
        nameAr: 'صنف لاختبار ثغرة السعر',
        units: [
          { unitId, factor: '1.000', isDefault: true, prices: [{ priceListId, price: '10.00' }] },
        ],
      }),
    })
    expect(created.statusCode).toBe(201)
    const productId = created.json<{ id: string }>().id

    // الكاشير يحاول رفع السعر إلى 999 عبر PUT /products/:id
    const attack = await app.inject({
      method: 'PUT',
      url: `/api/products/${productId}`,
      headers: auth(cashier.token),
      payload: productPayload({
        nameAr: 'صنف لاختبار ثغرة السعر',
        units: [
          { unitId, factor: '1.000', isDefault: true, prices: [{ priceListId, price: '999.00' }] },
        ],
      }),
    })

    // يُرفض عند حارس products.edit أصلاً (الكاشير لا يملكها)
    expect(attack.statusCode).toBe(403)

    // والسعر لم يتغيّر فعلاً في القاعدة
    const after = await app.inject({
      method: 'GET',
      url: `/api/products/${productId}`,
      headers: auth(owner.token),
    })
    const price = after.json<{ units: { prices: { price: string }[] }[] }>().units[0]!.prices[0]!
    expect(price.price).toBe('10.00')
  })

  /**
   * الشق الثاني من نفس الثغرة: دور يملك `products.edit` ولا يملك
   * `products.edit_price` — أمين المخزن. يجب أن يُرفض جسمه الحامل لأسعار
   * برسالة تقول له ماذا يفعل، لا أن تُحفظ الأسعار صامتة.
   */
  it('من يملك تعديل الصنف بلا تعديل السعر يُرفض عند إرسال أسعار', async () => {
    const stockKeeperToken = await tokenForRole('stock_keeper')

    const created = await app.inject({
      method: 'POST',
      url: '/api/products',
      headers: auth(owner.token),
      payload: productPayload({
        nameAr: 'صنف أمين المخزن',
        units: [
          { unitId, factor: '1.000', isDefault: true, prices: [{ priceListId, price: '20.00' }] },
        ],
      }),
    })
    const productId = created.json<{ id: string }>().id

    const withPrices = await app.inject({
      method: 'PUT',
      url: `/api/products/${productId}`,
      headers: auth(stockKeeperToken),
      payload: productPayload({
        nameAr: 'صنف أمين المخزن (سعر جديد)',
        units: [
          { unitId, factor: '1.000', isDefault: true, prices: [{ priceListId, price: '555.00' }] },
        ],
      }),
    })
    expect(withPrices.statusCode).toBe(403)
    expect(withPrices.json<{ error: { message: string } }>().error.message).toContain('الأسعار')

    // ونفس الطلب بلا أسعار ينجح — الرفض عن السعر لا عن التعديل كله
    const withoutPrices = await app.inject({
      method: 'PUT',
      url: `/api/products/${productId}`,
      headers: auth(stockKeeperToken),
      payload: productPayload({
        nameAr: 'صنف أمين المخزن (اسم جديد)',
        units: [{ unitId, factor: '1.000', isDefault: true, prices: [] }],
      }),
    })
    expect(withoutPrices.statusCode).toBe(200)

    const after = await app.inject({
      method: 'GET',
      url: `/api/products/${productId}`,
      headers: auth(owner.token),
    })
    expect(after.json<{ nameAr: string }>().nameAr).toBe('صنف أمين المخزن (اسم جديد)')
  })

  it('المالك يعدّل السعر بلا مانع', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/products',
      headers: auth(owner.token),
      payload: productPayload({
        nameAr: 'صنف المالك',
        units: [
          { unitId, factor: '1.000', isDefault: true, prices: [{ priceListId, price: '15.00' }] },
        ],
      }),
    })
    const productId = created.json<{ id: string }>().id

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/products/${productId}`,
      headers: auth(owner.token),
      payload: productPayload({
        nameAr: 'صنف المالك',
        units: [
          { unitId, factor: '1.000', isDefault: true, prices: [{ priceListId, price: '18.50' }] },
        ],
      }),
    })
    expect(updated.statusCode).toBe(200)
    expect(
      updated.json<{ units: { prices: { price: string }[] }[] }>().units[0]!.prices[0]!.price
    ).toBe('18.50')
  })
})

/** يصنع مستخدماً بدور معيّن ويعيد رمز جلسته — لاختبار أدوار بلا مستخدم في البذرة */
async function tokenForRole(roleName: string): Promise<string> {
  const { hash } = await import('@node-rs/argon2')
  const { roles, users } = await import('@falak/db')
  const { and, eq } = await import('drizzle-orm')

  const [role] = await app.db.select().from(roles).where(eq(roles.name, roleName)).limit(1)
  if (!role) throw new Error(`الدور ${roleName} غير موجود في البذرة`)

  const username = `test_${roleName}`
  const [existing] = await app.db
    .select()
    .from(users)
    .where(and(eq(users.username, username), eq(users.tenantId, role.tenantId)))
    .limit(1)

  if (!existing) {
    await app.db.insert(users).values({
      tenantId: role.tenantId,
      roleId: role.id,
      fullName: `مستخدم ${roleName}`,
      username,
      passwordHash: await hash('test-password-123', {
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      }),
    })
  }

  const session = await loginWithPassword(app, username, 'test-password-123')
  return session.token
}
