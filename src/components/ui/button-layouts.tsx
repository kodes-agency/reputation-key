import { Button, type ButtonProps } from './button'
import { cn } from '#/lib/utils'
type LayoutProps = Omit<ButtonProps, 'size' | 'touch'>
/** Multiline evidence row, a lazy variant of the canonical Button. */
export function RowButton({ className, ...props }: LayoutProps) {
  return (
    <Button
      {...props}
      size="inline"
      touch
      className={cn(
        'w-full justify-between whitespace-normal px-0 py-3 text-left',
        className,
      )}
    />
  )
}
/** A stable-width pill for a short, repeatable copy action. */
export function SummaryButton({ className, style, ...props }: LayoutProps) {
  return (
    <Button
      {...props}
      size="inline"
      touch
      style={{ ...style, minWidth: '14rem' }}
      className={cn('min-h-11 rounded-full px-4 py-3 text-base font-semibold', className)}
    />
  )
}
