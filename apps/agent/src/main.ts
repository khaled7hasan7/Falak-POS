import { buildApp } from './app.js'
import { loadConfig } from './config.js'

/**
 * نقطة إقلاع الوكيل المحلي.
 * يستمع على كل الواجهات ليخدم أجهزة المحل عبر LAN (ADR-001 قرار 2).
 */

async function main(): Promise<void> {
  const config = loadConfig()
  const app = await buildApp({ config })

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'إيقاف الوكيل')
    await app.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  await app.listen({ host: config.host, port: config.port })
  console.log(`وكيل فلك يعمل على http://localhost:${config.port}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
