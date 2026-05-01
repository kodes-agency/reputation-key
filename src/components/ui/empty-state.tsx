import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

type Props = Readonly<{
  icon: LucideIcon
  title: string
  children?: ReactNode
}>

export function EmptyState({ icon: Icon, title, children }: Props) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted">
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {children && <div className="flex flex-col items-center gap-2">{children}</div>}
    </div>
  )
}
