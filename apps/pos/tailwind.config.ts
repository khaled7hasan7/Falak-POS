import type { Config } from 'tailwindcss'
import preset from '@falak/ui/tailwind-preset'

/**
 * كل القيم من preset نظام التصميم (docs/03-design-system.md §14).
 * لا تُضف هنا لوناً ولا مقاساً — أضفه في الـ preset أولاً (القاعدة 5).
 */
export default {
  presets: [preset],
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
} satisfies Config
