import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * حارس نظام التصميم — يفرض القاعدة 5 في `CLAUDE.md` آلياً بدل الاعتماد على الانتباه.
 *
 * يفحص كل مصادر `packages/ui/src` (عدا `tokens.css` الذي **يعرّف** القيم) ويفشل عند:
 *   1. لون مكتوب مباشرة (`#rrggbb` أو `rgb(` أو `hsl(`)
 *   2. أي **أخضر** بأي صيغة — القرار الثابت في `docs/03-design-system.md §2.2`
 *   3. `left`/`right` بدل الخصائص المنطقية (§7)
 *   4. مقاس `px` مكتوب رقماً خارج قائمة استثناءات صريحة
 *
 * القائمة البيضاء للـ px تحتها سبب مكتوب — أي إضافة إليها قرار واعٍ لا تهرّب.
 */

/** جذر مصادر الحزمة. `process.cwd()` هو مجلد الحزمة لأن vitest يعمل بنطاقها،
 *  و`import.meta.url` لا يصلح هنا لأن بيئة jsdom لا تعطيه مساراً من نوع file. */
const SRC = resolve(process.cwd(), 'src')
const GUARD_FILE = resolve(SRC, '__tests__', 'design-rules.test.ts')

/** `tokens.css` هو مصدر القيم نفسه، فلا يخضع للفحص */
const EXEMPT_FILES = new Set(['tokens.css'])

/**
 * مقاسات px مسموحة، ولكلٍّ سبب من الوثيقة:
 *  - `1px` حدود: «الحدود: دائماً 1px solid var(--edge)» (§4)
 *  - `3px` شريط العنصر النشط وحلقة التركيز (§6.6 و§6.2)
 *  - `6px` نقطة الشارة (§6.3)
 *  - `9px`/`12px` حواف داخلية منصوصة في §6.5 و§6.6
 *  - `30px` صورة المستخدم في القائمة الجانبية (§6.6)
 *  - `2px` ضبابية خلفية النافذة (§6.7)
 *  - `480px`/`640px`/`960px` عروض النافذة sm/md/lg المنصوصة حرفياً في §6.7
 */
const ALLOWED_PX = new Set([
  '1px',
  '2px',
  '3px',
  '6px',
  '9px',
  '12px',
  '30px',
  '480px',
  '640px',
  '960px',
])

/** أسماء ألوان خضراء وأصنافها في تايلوند — ممنوعة كلها (§2.2) */
const GREEN_PATTERNS = [
  /\bgreen\b/i,
  /\bemerald\b/i,
  /\blime\b/i,
  /\bteal\b/i,
  /#[0-9a-f]*(?:0f0|00ff00)/i,
]

interface SourceFile {
  path: string
  relative: string
  content: string
  lines: string[]
}

function collectSources(dir: string, out: SourceFile[] = []): SourceFile[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      // مجلد الاختبارات نفسه يذكر الأنماط الممنوعة كنصوص، فيُستثنى
      if (entry === '__tests__') continue
      collectSources(full, out)
      continue
    }
    if (!['.ts', '.tsx', '.css'].includes(extname(entry))) continue
    if (EXEMPT_FILES.has(entry)) continue

    const content = readFileSync(full, 'utf8')
    out.push({
      path: full,
      relative: relative(SRC, full).replace(/\\/g, '/'),
      content,
      lines: content.split('\n'),
    })
  }
  return out
}

const sources = collectSources(SRC)

/** يمرّ على الأسطر ويجمع ما يطابق، مع تخطّي أسطر التعليق */
function findViolations(test: (line: string) => boolean): string[] {
  const found: string[] = []
  for (const file of sources) {
    file.lines.forEach((line, index) => {
      const trimmed = line.trim()
      // التعليقات تشرح القواعد وتذكر القيم، فلا تُفحص
      if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return
      if (test(line)) found.push(`${file.relative}:${index + 1} → ${trimmed}`)
    })
  }
  return found
}

describe('حارس نظام التصميم (CLAUDE.md القاعدة 5)', () => {
  it('يفحص ملفات فعلاً (حماية من حارس فارغ)', () => {
    expect(sources.length).toBeGreaterThan(8)
    expect(sources.some((f) => f.relative.endsWith('.tsx'))).toBe(true)
  })

  it('لا لون مكتوب مباشرة — كل الألوان من tokens', () => {
    const violations = findViolations(
      (line) => /#[0-9a-fA-F]{3,8}\b/.test(line) || /\b(?:rgb|rgba|hsl|hsla)\(/.test(line)
    )
    expect(violations).toEqual([])
  })

  it('لا أخضر في النظام إطلاقاً (docs/03 §2.2)', () => {
    const violations = findViolations((line) => GREEN_PATTERNS.some((p) => p.test(line)))
    expect(violations).toEqual([])
  })

  it('خصائص منطقية فقط — لا left/right ولا margin-left وأخواتها', () => {
    const violations = findViolations((line) => {
      // CSS: `left:` / `right:` / `margin-left` / `padding-right` / `border-left`
      if (/\b(?:margin|padding|border|inset)-(?:left|right)\b/.test(line)) return true
      if (/(?:^|[;{\s])(?:left|right)\s*:/.test(line)) return true
      // Tailwind: ml- mr- pl- pr- left- right- border-l border-r rounded-l rounded-r
      if (/(?:^|["'\s])(?:ml|mr|pl|pr)-\S/.test(line)) return true
      if (/(?:^|["'\s])(?:left|right)-\S/.test(line)) return true
      if (/(?:^|["'\s])(?:border|rounded)-(?:l|r)(?:-|\s|["'])/.test(line)) return true
      return false
    })
    expect(violations).toEqual([])
  })

  it('لا مقاس px خارج قائمة الاستثناءات المبرّرة', () => {
    const violations: string[] = []
    for (const file of sources) {
      file.lines.forEach((line, index) => {
        const trimmed = line.trim()
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return

        for (const match of line.matchAll(/(\d+(?:\.\d+)?px)/g)) {
          const value = match[1]!
          if (!ALLOWED_PX.has(value)) {
            violations.push(`${file.relative}:${index + 1} → ${value} في: ${trimmed}`)
          }
        }
      })
    }
    expect(violations).toEqual([])
  })

  it('كل استثناء px مذكور في القائمة له سبب موثّق في الملف', () => {
    const guardSource = readFileSync(GUARD_FILE, 'utf8')
    const reasoning = guardSource.slice(0, guardSource.indexOf('const ALLOWED_PX'))
    for (const value of ALLOWED_PX) {
      expect(reasoning, `الاستثناء ${value} بلا سبب مكتوب`).toContain(value)
    }
  })
})
