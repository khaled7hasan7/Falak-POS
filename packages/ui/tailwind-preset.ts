/**
 * preset تايلوند لنظام تصميم فلك — منقول حرفياً من docs/03-design-system.md §14
 * (`tailwind.config.ts`) مع حذف `content` وحده لأن المستهلك (apps/pos) هو من يحدّد
 * مساراته. لا تُضاف هنا قيمة غير موجودة في §14: القيمة الجديدة تُضاف للوثيقة أولاً.
 *
 * الاستخدام في apps/pos/tailwind.config.ts:
 *   import preset from '@falak/ui/tailwind-preset'
 *   export default { presets: [preset], content: ['./src/**\/*.{ts,tsx,html}'] }
 */
import type { Config } from 'tailwindcss'

const preset = {
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        falak: {
          50: '#F2F7FF',
          100: '#E1EEFF',
          200: '#BBDBFF',
          300: '#85BEFF',
          400: '#4C9BFF',
          500: '#1F6FEB',
          600: '#164FB0',
          700: '#123066',
          800: '#0C1F45',
          900: '#071229',
          950: '#03070F',
        },
        glow: '#7FB3FF',
        page: 'var(--page)',
        surface: 'var(--surface)',
        box: 'var(--box)',
        edge: 'var(--edge)',
        'edge-strong': 'var(--edge-strong)',
        text: 'var(--text)',
        soft: 'var(--soft)',
        'soft-2': 'var(--soft-2)',
        muted: 'var(--muted)',
        primary: { DEFAULT: 'var(--primary)', hover: 'var(--primary-hover)' },
        ok: { DEFAULT: 'var(--ok)', bg: 'var(--ok-bg)', fg: 'var(--ok-fg)' },
        warn: { DEFAULT: '#E08700', bg: 'var(--warn-bg)', fg: 'var(--warn-fg)' },
        danger: { DEFAULT: '#E0344A', bg: 'var(--danger-bg)', fg: 'var(--danger-fg)' },
        info: { bg: 'var(--info-bg)', fg: 'var(--info-fg)' },
      },
      fontFamily: { sans: ['var(--font-ui)'], num: ['var(--font-num)'] },
      fontSize: {
        display: ['40px', '1.15'],
        h1: ['26px', '1.3'],
        h2: ['18px', '1.35'],
        h3: ['15.5px', '1.4'],
        body: ['15px', '1.75'],
        ui: ['14px', '1.4'],
        small: ['13px', '1.6'],
        label: ['11px', '1'],
        'num-xl': ['44px', '1.1'],
        'num-lg': ['26px', '1.2'],
      },
      borderRadius: { xs: '6px', sm: '8px', DEFAULT: '10px', lg: '14px', pill: '999px' },
      boxShadow: { 1: 'var(--shadow-1)', 2: 'var(--shadow-2)', blue: 'var(--shadow-blue)' },
      spacing: {
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px',
        6: '24px',
        8: '32px',
        12: '48px',
        16: '64px',
      },
      height: { btn: '44px', 'btn-sm': '36px', 'btn-xl': '64px', input: '44px' },
      width: { sidebar: '220px', 'pos-panel': '340px' },
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- إعداد تايلوند يُحمَّل عبر jiti (CJS)
  plugins: [require('tailwindcss-rtl')],
} satisfies Omit<Config, 'content'>

export default preset
