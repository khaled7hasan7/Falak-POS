import { connect, getDatabaseUrl } from '../client.js'
import { runMigrations } from '../migrator.js'
import { seed } from './seed.js'

/**
 * هدم القاعدة وإعادة بنائها من الصفر ثم بذرها.
 * يُستخدم في التطوير فقط — `pnpm db:reset`.
 *
 * حماية: يرفض العمل إن كان `NODE_ENV=production` لأن الأمر يمسح كل شيء.
 */

const DROP_AND_RECREATE = `
  DROP SCHEMA IF EXISTS public CASCADE;
  CREATE SCHEMA public;
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
`

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('رُفض: db:reset يمسح القاعدة بالكامل ولا يعمل عندما NODE_ENV=production.')
  }

  const url = getDatabaseUrl()
  const { pool, db, close } = connect(url)

  try {
    console.log('⌦ هدم المخطط public وإعادة إنشائه…')
    await pool.query(DROP_AND_RECREATE)

    console.log('⇪ تطبيق الترحيلات…')
    const report = await runMigrations(pool)
    console.log('  طُبّق: ' + report.applied.join('، '))

    console.log('⌸ بذر البيانات…')
    const result = await seed(db)
    console.log(
      '✓ جاهزة: ' +
        result.products +
        ' صنف · ' +
        result.barcodes +
        ' باركود · ' +
        result.roleCount +
        ' أدوار'
    )
    console.log('  الدخول: khaled (كلمة مرور من SEED_OWNER_PASSWORD) أو cashier بـ PIN 1234')
  } finally {
    await close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
