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
