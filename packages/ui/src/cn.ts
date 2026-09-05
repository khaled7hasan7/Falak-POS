import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** دمج أصناف تايلوند مع حسم التعارض (الأخير يفوز). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
