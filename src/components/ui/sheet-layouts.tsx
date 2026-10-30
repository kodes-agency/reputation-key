import { SheetTitle } from './sheet'
import { cn } from '#/lib/utils'
import type { ReactNode, ComponentProps } from 'react'
export type SheetLayout = Readonly<{ className: string; decoration?: ReactNode }>
/** Side on desktop, bottom on phones. Imported by the lazy detail sheet, never the shell. */
export const RESPONSIVE_DETAIL_SHEET: SheetLayout = {
  className:
    'responsive-detail-sheet right-0 bottom-0 max-h-[calc(100dvh-2rem)] w-full gap-0 overflow-hidden rounded-t-2xl md:inset-y-0 md:max-h-none max-w-xl md:rounded-none md:border-l ease-out motion-reduce:animate-none data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
  decoration: (
    <>
      <style>
        {
          '@media(min-width:48rem){.responsive-detail-sheet{--tw-enter-translate-x:100%;--tw-exit-translate-x:100%;--tw-enter-translate-y:0;--tw-exit-translate-y:0}}'
        }
      </style>
      <div
        aria-hidden="true"
        className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/40 md:hidden"
      />
    </>
  ),
}

export function SheetDetailTitle({
  className,
  style,
  ...props
}: ComponentProps<typeof SheetTitle>) {
  return (
    <SheetTitle
      {...props}
      style={{ ...style, fontSize: 22 }}
      className={cn('font-bold tracking-tight outline-none', className)}
    />
  )
}
