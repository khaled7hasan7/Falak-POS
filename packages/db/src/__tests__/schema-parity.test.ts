import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getTableColumns, getTableName, is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'
import { setupTestDatabase, type TestContext } from './helpers.js'
import * as schema from '../schema/index.js'

/**
 * حارس تطابق المخطط.
 *
 * `migrations/0001_init.sql` نسخة حرفية من `docs/falak_pos_schema.sql`، أما مخطط
 * Drizzle فمكتوب بيد الإنسان — فأي خطأ نسخ (عمود ناقص، نوع مختلف، NOT NULL منسيّة)
 * يمرّ صامتاً حتى ينفجر في وقت التشغيل. هذا الاختبار يقارن القاعدة الحيّة بعد
 * الترحيلات بتعريفات Drizzle **عموداً بعمود** فيفشل عند أول فرق.
 */

interface DbColumn {
  table_name: string
  column_name: string
  data_type: string
  /** نوع PostgreSQL الداخلي — يلزم للمصفوفات لأن `data_type` يقول `ARRAY` فقط */
  udt_name: string
  is_nullable: 'YES' | 'NO'
  numeric_precision: number | null
  numeric_scale: number | null
  character_maximum_length: number | null
}

let ctx: TestContext
let dbColumns: Map<string, Map<string, DbColumn>>

/** جداول Drizzle المصدَّرة من المخطط، مفهرسة باسم الجدول في القاعدة */
function drizzleTables(): Map<string, PgTable> {
  const tables = new Map<string, PgTable>()
  for (const value of Object.values(schema)) {
    if (is(value, PgTable)) {
      tables.set(getTableName(value), value)
    }
  }
  return tables
}

/** نوع عمود Drizzle كما تراه PostgreSQL في `information_schema` */
function expectedSqlType(columnType: string, sqlName: string): string {
  // `getSQLType()` يعطي مثل `numeric(14, 2)` أو `character(3)`؛ نأخذ الاسم الأساسي
  const base = sqlName.replace(/\(.*\)$/, '').trim()
  const map: Record<string, string> = {
    'timestamp with time zone': 'timestamp with time zone',
    varchar: 'character varying',
    char: 'character',
    bigserial: 'bigint',
    serial: 'integer',
  }
  return map[base] ?? map[columnType] ?? base
}

beforeAll(async () => {
  ctx = await setupTestDatabase()
  const { rows } = await ctx.pool.query<DbColumn>(
    `SELECT table_name, column_name, data_type, udt_name, is_nullable,
            numeric_precision, numeric_scale, character_maximum_length
     FROM information_schema.columns
     WHERE table_schema = 'public'`
  )
  dbColumns = new Map()
  for (const row of rows) {
    if (!dbColumns.has(row.table_name)) dbColumns.set(row.table_name, new Map())
    dbColumns.get(row.table_name)!.set(row.column_name, row)
  }
})

afterAll(async () => {
  await ctx.close()
})

describe('تطابق مخطط Drizzle مع القاعدة المُرحَّلة', () => {
  it('يغطي كل جداول القاعدة الـ65 بلا زيادة ولا نقصان', () => {
    const drizzleNames = [...drizzleTables().keys()].sort()
    const dbNames = [...dbColumns.keys()].sort()

    expect(dbNames).toHaveLength(65)
    expect(drizzleNames).toEqual(dbNames)
  })

  it('كل جدول في Drizzle له نفس أعمدة القاعدة بلا نقص', () => {
    const missing: string[] = []

    for (const [tableName, table] of drizzleTables()) {
      const actual = dbColumns.get(tableName)
      if (!actual) continue
      for (const column of Object.values(getTableColumns(table))) {
        if (!actual.has(column.name)) {
          missing.push(`${tableName}.${column.name} — معرّف في Drizzle وغير موجود في القاعدة`)
        }
      }
      for (const dbName of actual.keys()) {
        const declared = Object.values(getTableColumns(table)).some((c) => c.name === dbName)
        if (!declared) {
          missing.push(`${tableName}.${dbName} — موجود في القاعدة وغير معرّف في Drizzle`)
        }
      }
    }

    expect(missing).toEqual([])
  })

  it('أنواع الأعمدة ودقّتها متطابقة (لا float مكان numeric)', () => {
    const mismatches: string[] = []

    for (const [tableName, table] of drizzleTables()) {
      const actual = dbColumns.get(tableName)
      if (!actual) continue

      for (const column of Object.values(getTableColumns(table))) {
        const dbColumn = actual.get(column.name)
        if (!dbColumn) continue

        const expected = expectedSqlType(column.columnType, column.getSQLType())

        // المصفوفات: `data_type` يقول ARRAY فقط، ونوع العنصر في `udt_name` مسبوقاً بشرطة سفلية
        if (expected.endsWith('[]')) {
          const elementType = expected.slice(0, -2)
          const dbElementType = dbColumn.udt_name.replace(/^_/, '')
          if (dbColumn.data_type !== 'ARRAY' || dbElementType !== elementType) {
            mismatches.push(
              `${tableName}.${column.name}: Drizzle=${expected} · ` +
                `القاعدة=${dbColumn.data_type}(${dbColumn.udt_name})`
            )
          }
          continue
        }

        if (dbColumn.data_type !== expected) {
          mismatches.push(
            `${tableName}.${column.name}: Drizzle=${expected} · القاعدة=${dbColumn.data_type}`
          )
          continue
        }

        // الدقّة والمقياس للأعمدة الرقمية — جوهر ADR-002
        if (dbColumn.data_type === 'numeric') {
          const declared = column.getSQLType().match(/numeric\((\d+),\s*(\d+)\)/)
          if (declared) {
            const [, precision, scale] = declared
            if (
              Number(precision) !== dbColumn.numeric_precision ||
              Number(scale) !== dbColumn.numeric_scale
            ) {
              mismatches.push(
                `${tableName}.${column.name}: Drizzle=numeric(${precision},${scale}) · ` +
                  `القاعدة=numeric(${dbColumn.numeric_precision},${dbColumn.numeric_scale})`
              )
            }
          }
        }
      }
    }

    expect(mismatches).toEqual([])
  })

  it('قابلية NULL متطابقة', () => {
    const mismatches: string[] = []

    for (const [tableName, table] of drizzleTables()) {
      const actual = dbColumns.get(tableName)
      if (!actual) continue

      for (const column of Object.values(getTableColumns(table))) {
        const dbColumn = actual.get(column.name)
        if (!dbColumn) continue

        const dbNotNull = dbColumn.is_nullable === 'NO'
        if (column.notNull !== dbNotNull) {
          mismatches.push(
            `${tableName}.${column.name}: Drizzle notNull=${column.notNull} · ` +
              `القاعدة NOT NULL=${dbNotNull}`
          )
        }
      }
    }

    expect(mismatches).toEqual([])
  })

  it('لا عمود مالي بنوع عائم في القاعدة كلها (القاعدة 3)', async () => {
    const { rows } = await ctx.pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public'
         AND data_type IN ('double precision', 'real')`
    )
    expect(rows).toEqual([])
  })
})
