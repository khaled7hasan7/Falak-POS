import { createPool, getDatabaseUrl } from '../client.js'
import { runMigrations } from '../migrator.js'

/** `pnpm --filter @falak/db migrate` — يطبّق الترحيلات الناقصة على `DATABASE_URL`. */
async function main(): Promise<void> {
  const pool = createPool(getDatabaseUrl())
  try {
    const { applied, skipped } = await runMigrations(pool)

    for (const version of skipped) console.log(`⏭  متخطّى (مطبَّق مسبقاً): ${version}`)
    for (const version of applied) console.log(`✓  طُبّق: ${version}`)

    if (applied.length === 0) console.log('لا ترحيلات ناقصة — القاعدة محدَّثة.')
    else console.log(`تم تطبيق ${applied.length} ترحيلاً.`)
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
