import type { Pool } from 'pg'
import { connect, getTestDatabaseUrl } from '../client.js'
import { runMigrations } from '../migrator.js'
import { branches, tenants, users, warehouses, roles } from '../schema/index.js'

/**
 * أدوات اختبارات القاعدة.
 *
 * كل ملف اختبار يبني قاعدة `falak_pos_test` من الترحيلات من الصفر، فلا يعتمد
 * على حالة سابقة. المرجع: `CLAUDE.md §5` — قاعدة اختبار منفصلة تُبنى وتُهدم.
 */

const DROP_AND_RECREATE = `
  DROP SCHEMA IF EXISTS public CASCADE;
  CREATE SCHEMA public;
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
`

export type TestContext = Awaited<ReturnType<typeof setupTestDatabase>>

/** يهدم قاعدة الاختبار ويعيد بناءها من الترحيلات، ويعيد اتصالاً جاهزاً */
export async function setupTestDatabase() {
  const ctx = connect(getTestDatabaseUrl())
  await ctx.pool.query(DROP_AND_RECREATE)
  await runMigrations(ctx.pool)
  return ctx
}

/** يمسح بيانات الأعمال بين الاختبارات مع إبقاء المخطط والبيانات المرجعية (العملات، الباقات) */
export async function truncateBusinessTables(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename NOT IN ('currencies', 'plans', 'schema_migrations')`
  )
  const list = rows.map((r) => '"' + r.tablename + '"').join(', ')
  await pool.query('TRUNCATE ' + list + ' RESTART IDENTITY CASCADE')
}

export interface MinimalTenant {
  tenantId: string
  branchId: string
  warehouseId: string
  userId: string
  roleId: string
}

/**
 * أقل ما يلزم لاختبار حركة: مستأجر وفرع ومخزن ودور ومستخدم.
 * لا يبذر كتالوجاً — كل اختبار يصنع ما يحتاجه فقط.
 */
export async function createMinimalTenant(
  ctx: TestContext,
  name = 'مستأجر اختبار'
): Promise<MinimalTenant> {
  const [tenant] = await ctx.db.insert(tenants).values({ name }).returning()
  if (!tenant) throw new Error('تعذّر إنشاء مستأجر الاختبار')

  const [branch] = await ctx.db
    .insert(branches)
    .values({ tenantId: tenant.id, name: 'فرع', isMain: true })
    .returning()
  if (!branch) throw new Error('تعذّر إنشاء الفرع')

  const [warehouse] = await ctx.db
    .insert(warehouses)
    .values({ tenantId: tenant.id, branchId: branch.id, name: 'مخزن', isDefault: true })
    .returning()
  if (!warehouse) throw new Error('تعذّر إنشاء المخزن')

  const [role] = await ctx.db
    .insert(roles)
    .values({ tenantId: tenant.id, name: 'owner', permissions: [], isSystem: true })
    .returning()
  if (!role) throw new Error('تعذّر إنشاء الدور')

  const [user] = await ctx.db
    .insert(users)
    .values({
      tenantId: tenant.id,
      roleId: role.id,
      branchId: branch.id,
      fullName: 'مستخدم اختبار',
      username: 'tester',
    })
    .returning()
  if (!user) throw new Error('تعذّر إنشاء المستخدم')

  return {
    tenantId: tenant.id,
    branchId: branch.id,
    warehouseId: warehouse.id,
    userId: user.id,
    roleId: role.id,
  }
}
