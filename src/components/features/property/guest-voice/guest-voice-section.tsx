import {
  TriangleAlert,
  TrendingUp,
  TrendingDown,
  Flag,
  ThumbsUp,
  CircleCheck,
  MessageCircle,
} from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { CheckInSection } from '#/components/features/shared/check-in-section'

/** Guest voice keeps its established icon vocabulary over the shared card. */
export function GuestVoiceSection({
  icon = 'flag',
  ...props
}: Omit<ComponentProps<typeof CheckInSection>, 'icon'> &
  Readonly<{
    icon?: 'urgent' | 'up' | 'down' | 'flag' | 'praise' | 'quiet' | 'reviews'
  }>) {
  const Icon = {
    urgent: TriangleAlert,
    up: TrendingUp,
    down: TrendingDown,
    flag: Flag,
    praise: ThumbsUp,
    quiet: CircleCheck,
    reviews: MessageCircle,
  }[icon]
  return (
    <CheckInSection {...props} icon={<Icon aria-hidden="true" className="size-4" />} />
  )
}
export function GuestVoiceNothingHere({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="py-2 text-sm text-muted-foreground">{children}</p>
}
