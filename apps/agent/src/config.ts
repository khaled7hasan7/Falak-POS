import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadDotenv } from 'dotenv'

/**
 * إعدادات الوكيل المحلي — تُقرأ مرة واحدة عند الإقلاع وتفشل بسرعة إن نقص شيء.
 * المرجع: `docs/01-project-and-permissions.md §9` (الوكيل مصدر الحقيقة في المحل).
 */

const REPO_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)))

loadDotenv({ path: resolve(REPO_ROOT, '.env'), quiet: true })

/** أقل طول مقبول لسر التوقيع — أقصر منه يجعل HS256 قابلاً للكسر عملياً */
const MIN_SECRET_LENGTH = 32

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`متغير البيئة ${name} غير معرّف. انسخ .env.example إلى .env في جذر المستودع.`)
  }
  return value
}

function numeric(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`متغير البيئة ${name} يجب أن يكون رقماً موجباً، وصل: "${raw}"`)
  }
  return value
}

export interface AgentConfig {
  databaseUrl: string
  host: string
  port: number
  jwtSecret: string
  sessionTtlHours: number
  isProduction: boolean
}

export function loadConfig(): AgentConfig {
  const jwtSecret = required('AGENT_JWT_SECRET')
  const isProduction = process.env.NODE_ENV === 'production'

  if (jwtSecret.length < MIN_SECRET_LENGTH) {
    throw new Error(`AGENT_JWT_SECRET أقصر من ${MIN_SECRET_LENGTH} حرفاً. ولّد سراً عشوائياً أطول.`)
  }
  // سر التطوير الافتراضي لا يُقبل على جهاز عميل حقيقي
  if (isProduction && jwtSecret.includes('dev_only')) {
    throw new Error('AGENT_JWT_SECRET ما زال قيمة التطوير الافتراضية. ولّد سراً حقيقياً للإنتاج.')
  }

  return {
    databaseUrl: required('DATABASE_URL'),
    host: process.env.AGENT_HOST ?? '0.0.0.0',
    port: numeric('AGENT_PORT', 5111),
    jwtSecret,
    sessionTtlHours: numeric('AGENT_SESSION_TTL_HOURS', 12),
    isProduction,
  }
}
