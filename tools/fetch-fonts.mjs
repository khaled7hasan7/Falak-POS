#!/usr/bin/env node
/**
 * تنزيل خطوط Falak POS محلياً إلى packages/ui/fonts
 * ------------------------------------------------------------------
 * docs/03-design-system.md §3: الخطوط تُحزَّم محلياً لأن العميل بلا إنترنت.
 * لا Google Fonts في وقت التشغيل — الملفات تُودَع في git.
 *
 * المصادر (كلاهما SIL Open Font License 1.1 = إعادة التوزيع مسموحة):
 *   IBM Plex Sans Arabic → حزمة IBM الرسمية @ibm/plex-sans-arabic مثبّتة على إصدار
 *                          ثابت عبر jsDelivr (نفس بايتات مستودع IBM/plex).
 *   Space Grotesk        → المستودع الرسمي floriankarsten/space-grotesk على وسم ثابت.
 *
 * ملاحظة على Space Grotesk: المستودع الرسمي (وGoogle Fonts) لا يوزّعان نسخة
 * ثابتة (static) بوزن 600؛ الوزن 600 موجود فقط داخل الملف المتغيّر (variable)
 * على محور wght من 300 إلى 700. لذلك نُنزّل الملف المتغيّر مرة واحدة ونعرّفه في
 * fonts.css بـ `font-weight: 300 700` فيغطّي الأوزان 400/500/600/700 المطلوبة
 * بملف واحد (49KB) وبمجموعة محارف كاملة غير مُقتطعة (يشمل ₪).
 *
 * الاستخدام: node tools/fetch-fonts.mjs [--force]
 */

import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'packages', 'ui', 'fonts')

/** إصدارات مثبّتة — لا تُحدَّث تلقائياً حتى لا تتغير الخطوط تحت أقدامنا. */
const PLEX_PKG = '@ibm/plex-sans-arabic@1.1.0'
const GROTESK_TAG = '2.0.0'

const PLEX_BASE = `https://cdn.jsdelivr.net/npm/${PLEX_PKG}`
const GROTESK_BASE = `https://raw.githubusercontent.com/floriankarsten/space-grotesk/${GROTESK_TAG}`

/** أصغر حجم مقبول لملف خط سليم (بايت) — يكشف صفحات الخطأ المحفوظة كملفات. */
const MIN_FONT_BYTES = 5_000
/** أصغر حجم مقبول لملف رخصة. */
const MIN_TEXT_BYTES = 500

/** @type {{ file: string, url: string, kind: 'font' | 'text', label: string }[]} */
const ASSETS = [
  // IBM Plex Sans Arabic — الأوزان الخمسة المطلوبة في §3
  ...[
    ['Light', 300],
    ['Regular', 400],
    ['Medium', 500],
    ['SemiBold', 600],
    ['Bold', 700],
  ].map(([name, weight]) => ({
    file: `IBMPlexSansArabic-${name}.woff2`,
    url: `${PLEX_BASE}/fonts/complete/woff2/IBMPlexSansArabic-${name}.woff2`,
    kind: /** @type {const} */ ('font'),
    label: `IBM Plex Sans Arabic ${weight}`,
  })),
  // Space Grotesk — ملف متغيّر واحد يغطي 300..700 (ومنها 400/500/600/700)
  {
    file: 'SpaceGrotesk-Variable.woff2',
    url: `${GROTESK_BASE}/fonts/woff2/${encodeURIComponent('SpaceGrotesk[wght].woff2')}`,
    kind: /** @type {const} */ ('font'),
    label: 'Space Grotesk 300–700 (variable)',
  },
  // نصوص الرخص — شرط إعادة التوزيع تحت OFL
  {
    file: 'LICENSE-IBMPlexSansArabic.txt',
    url: `${PLEX_BASE}/LICENSE.txt`,
    kind: /** @type {const} */ ('text'),
    label: 'رخصة IBM Plex (OFL 1.1)',
  },
  {
    file: 'LICENSE-SpaceGrotesk.txt',
    url: `${GROTESK_BASE}/OFL.txt`,
    kind: /** @type {const} */ ('text'),
    label: 'رخصة Space Grotesk (OFL 1.1)',
  },
]

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const force = process.argv.includes('--force')

/** يتحقق أن البايتات خط woff2 حقيقي (التوقيع `wOF2`). */
function isWoff2(buffer) {
  return buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'wOF2'
}

async function download(asset) {
  const dest = path.join(OUT_DIR, asset.file)

  if (!force && existsSync(dest)) {
    const { size } = await stat(dest)
    const floor = asset.kind === 'font' ? MIN_FONT_BYTES : MIN_TEXT_BYTES
    if (size >= floor) return { ...asset, size, action: 'skipped' }
  }

  let response
  try {
    response = await fetch(asset.url, { headers: { 'user-agent': USER_AGENT } })
  } catch (cause) {
    throw new Error(`تعذّر الاتصال بـ ${asset.url}\n  السبب: ${cause.message}`, { cause })
  }
  if (!response.ok) {
    throw new Error(`فشل تنزيل ${asset.file}: HTTP ${response.status} من ${asset.url}`)
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  const floor = asset.kind === 'font' ? MIN_FONT_BYTES : MIN_TEXT_BYTES
  if (bytes.length < floor) {
    throw new Error(
      `الملف ${asset.file} صغير بشكل غير معقول (${bytes.length}B) — المصدر ${asset.url}`
    )
  }
  if (asset.kind === 'font' && !isWoff2(bytes)) {
    throw new Error(`الملف ${asset.file} ليس woff2 صالحاً (التوقيع غير wOF2) — المصدر ${asset.url}`)
  }

  await writeFile(dest, bytes)
  return { ...asset, size: bytes.length, action: 'downloaded' }
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)}KB`

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  console.log(`الوجهة: ${path.relative(ROOT, OUT_DIR)}\n`)

  const results = []
  const failures = []
  for (const asset of ASSETS) {
    try {
      const result = await download(asset)
      results.push(result)
      const verb = result.action === 'skipped' ? 'موجود مسبقاً' : 'نُزّل'
      console.log(
        `  ${verb.padEnd(12)} ${result.file.padEnd(38)} ${kb(result.size).padStart(9)}  ${result.label}`
      )
    } catch (error) {
      failures.push(error)
      console.error(`  فشل         ${asset.file}\n    ${error.message}`)
    }
  }

  if (failures.length > 0) {
    console.error(
      `\n${failures.length} ملف/ملفات لم تُنزَّل. الخطوط شرط لبناء الواجهة (docs/03 §3) —` +
        ` تحقّق من الاتصال ثم أعد التشغيل: node tools/fetch-fonts.mjs`
    )
    process.exitCode = 1
    return
  }

  const fonts = results.filter((r) => r.kind === 'font')
  const total = fonts.reduce((sum, r) => sum + r.size, 0)
  const downloaded = results.filter((r) => r.action === 'downloaded').length
  console.log(
    `\nتم: ${fonts.length} ملف خط (${kb(total)} إجمالاً)، ${downloaded} جديد، ` +
      `${results.length - downloaded} متخطّى. الملفات تُودَع في git.`
  )

  const stray = (await readdir(OUT_DIR)).filter(
    (name) => name !== '.gitignore' && !ASSETS.some((a) => a.file === name)
  )
  if (stray.length > 0) {
    console.warn(`تنبيه: ملفات لا يعرفها السكربت في مجلد الخطوط: ${stray.join(', ')}`)
  }
}

await main()
