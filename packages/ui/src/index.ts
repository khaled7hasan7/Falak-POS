/**
 * @falak/ui — نظام التصميم في الكود.
 *
 * كل قيمة هنا مصدرها `docs/03-design-system.md`، وكل لون ومقاس يأتي من
 * `tokens.css` (§14). القاعدة 5 في `CLAUDE.md`: **لا لون ولا مقاس خارج الـ tokens،
 * ولا أخضر في النظام إطلاقاً**، وكل رقم/مبلغ/باركود بصنف `num`، والخصائص
 * المنطقية (`inline-start`) لا `left`/`right` — يفرضها اختبار الحارس آلياً.
 *
 * الأنماط تُستورد من `@falak/ui/tokens.css` و`@falak/ui/fonts.css` في التطبيق.
 */
export { cn } from './cn'
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button'
export { Input, Field, type InputProps, type FieldProps } from './Input'
export { Badge, type BadgeProps, type BadgeTone } from './Badge'
export { Tag, type TagProps } from './Tag'
export { Table, ROWS_PER_PAGE, type TableProps, type Column } from './Table'
export {
  Dialog,
  PinDialog,
  PIN_LENGTH,
  type DialogProps,
  type DialogSize,
  type PinDialogProps,
} from './Dialog'
export {
  ToastProvider,
  useToast,
  TOAST_TONES,
  TOAST_DURATION_MS,
  type ToastOptions,
  type ToastTone,
} from './Toast'
export { Sidebar, type SidebarProps, type SidebarItem } from './Sidebar'
export { Kpi, type KpiProps } from './Kpi'
export { EmptyState, type EmptyStateProps } from './EmptyState'
export { Skeleton, SkeletonRows, type SkeletonProps } from './Skeleton'
