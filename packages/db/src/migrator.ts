import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pool } from 'pg'

/**
 * مطبِّق الترحيلات. المرجع: `docs/02-database.md §8`.
 *
 * القواعد:
 * 1. ملفات `migrations/*.sql` بالترتيب الأبجدي، **الناقصة فقط**.
 * 2. كل ملف داخل **معاملة واحدة** — إما يُطبَّق كاملاً أو لا شيء.
 * 3. النسخة تُسجَّل في `schema_migrations` ليقرأها الوكيل عند التحديث الذاتي.
 * 4. `schema_migrations` نفسه يُنشأ داخل `0001`، فالحالة الأولى (الجدول غير موجود) متوقّعة.
 */

/** مجلد الترحيلات — من `packages/db/src/` نصعد درجة واحدة */
export const MIGRATIONS_DIR = resolve(fileURLToPath(new URL('../migrations/', import.meta.url)))

/** رمز PostgreSQL لـ «الجدول غير موجود» */
const UNDEFINED_TABLE = '42P01'

export interface MigrationReport {
  applied: string[]
  skipped: string[]
}

function isUndefinedTable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === UNDEFINED_TABLE
  )
}

/** أسماء الترحيلات المتاحة على القرص، بالترتيب الأبجدي */
export async function listMigrations(): Promise<string[]> {
  const files = await readdir(MIGRATIONS_DIR)
  return files.filter((f) => f.endsWith('.sql')).sort()
}

/** النسخ المسجّلة في `schema_migrations` — مجموعة فارغة إن لم يوجد الجدول بعد */
export async function appliedVersions(pool: Pool): Promise<Set<string>> {
  try {
    const { rows } = await pool.query<{ version: string }>('SELECT version FROM schema_migrations')
    return new Set(rows.map((r) => r.version))
  } catch (error) {
    if (isUndefinedTable(error)) return new Set()
    throw error
  }
}

/** اسم النسخة = اسم الملف بلا اللاحقة (`0001_init.sql` ← `0001_init`) */
export const versionOf = (fileName: string): string => fileName.replace(/\.sql$/, '')

export async function runMigrations(pool: Pool): Promise<MigrationReport> {
  const files = await listMigrations()
  const done = await appliedVersions(pool)
  const report: MigrationReport = { applied: [], skipped: [] }

  for (const file of files) {
    const version = versionOf(file)
    if (done.has(version)) {
      report.skipped.push(version)
      continue
    }

    const sql = await readFile(resolve(MIGRATIONS_DIR, file), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query(
        'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING',
        [version]
      )
      await client.query('COMMIT')
      report.applied.push(version)
    } catch (error) {
      await client.query('ROLLBACK')
      throw new Error(`فشل الترحيل ${version}: ${(error as Error).message}`, { cause: error })
    } finally {
      client.release()
    }
  }

  return report
}
