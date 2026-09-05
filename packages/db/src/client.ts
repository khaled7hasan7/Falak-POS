import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadDotenv } from 'dotenv'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import type { PoolConfig } from 'pg'
import * as schema from './schema/index.js'

/**
 * اتصال القاعدة المشترك لكل سكربتات واختبارات الحزمة.
 * المرجع: `CLAUDE.md §5` — PostgreSQL 16 على المنفذ **5433** محلياً.
 *
 * ملاحظة ADR-002 §3: سائق `pg` يعيد `numeric` **كنص** وهذا مقصود ولا يُعطَّل.
 */

/** جذر المستودع — من `packages/db/src/` نصعد ثلاث درجات */
export const REPO_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)))

let envLoaded = false

/** يقرأ `.env` من جذر المستودع مرة واحدة (لا يدهس متغيرات البيئة الموجودة) */
export function loadEnv(): void {
  if (envLoaded) return
  loadDotenv({ path: resolve(REPO_ROOT, '.env'), quiet: true })
  envLoaded = true
}

function readUrl(varName: string): string {
  loadEnv()
  const url = process.env[varName]
  if (!url) {
    throw new Error(
      `متغير البيئة ${varName} غير معرّف. انسخ .env.example إلى .env في جذر المستودع.`
    )
  }
  return url
}

/** رابط قاعدة التطوير */
export const getDatabaseUrl = (): string => readUrl('DATABASE_URL')

/** رابط قاعدة الاختبارات — تُبنى وتُهدم في كل تشغيل (`CLAUDE.md §5`) */
export const getTestDatabaseUrl = (): string => readUrl('TEST_DATABASE_URL')

export function createPool(connectionString: string, extra: PoolConfig = {}): Pool {
  return new Pool({ connectionString, ...extra })
}

export function createDb(pool: Pool) {
  return drizzle(pool, { schema })
}

export type Database = ReturnType<typeof createDb>

/** اتصال + عميل Drizzle جاهزان، مع دالة إغلاق واحدة */
export function connect(connectionString: string = getDatabaseUrl()) {
  const pool = createPool(connectionString)
  return {
    pool,
    db: createDb(pool),
    close: () => pool.end(),
  }
}

/**
 * المعاملة كما يمرّرها `db.transaction(...)`.
 * نوعها يختلف عن `Database` (لا تحمل `$client`)، فيلزم نوع يجمعهما.
 */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * ما يقبل تنفيذ استعلام: الاتصال نفسه أو معاملة داخله.
 * كل دالة تكتب في القاعدة تأخذ `Executor` لا `Database`، فتصلح للاستدعاء
 * داخل معاملة وخارجها بلا تحويل نوع قسري (القاعدة 4 تفرض المعاملة عادةً).
 */
export type Executor = Database | Transaction

/**
 * يضمن وجود قاعدة اختبار باسم مشتق من `TEST_DATABASE_URL`.
 *
 * لماذا قاعدة لكل حزمة؟ لأن turbo يشغّل اختبارات الحزم **بالتوازي**، وكلٌّ منها
 * يهدم المخطط ويعيد بناءه — فلو تشاركت قاعدة واحدة هدم بعضها بعضاً في منتصف
 * التشغيل. الاسم `falak_pos_test_<suffix>` يفصلها، وإنشاؤها هنا يعني ألا يحتاج
 * أحد (ولا CI) خطوة تهيئة يدوية.
 */
export async function ensureTestDatabase(suffix: string): Promise<string> {
  const base = getTestDatabaseUrl()
  const url = new URL(base)
  const baseName = url.pathname.replace(/^\//, '')
  const name = `${baseName}_${suffix}`

  // الاتصال بقاعدة `postgres` الإدارية لإنشاء قاعدتنا إن لم توجد
  const admin = new URL(base)
  admin.pathname = '/postgres'
  const adminPool = createPool(admin.toString())
  try {
    const { rows } = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])
    if (rows.length === 0) {
      // اسم القاعدة لا يقبل معاملاً مربوطاً؛ مشتقّ من اسمنا لا من مدخل مستخدم
      await adminPool.query(`CREATE DATABASE "${name}"`)
    }
  } finally {
    await adminPool.end()
  }

  url.pathname = `/${name}`
  const dbUrl = url.toString()

  const pool = createPool(dbUrl)
  try {
    await pool.query(
      'CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm'
    )
  } finally {
    await pool.end()
  }

  return dbUrl
}
