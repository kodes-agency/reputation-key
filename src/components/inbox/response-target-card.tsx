import { Clock3 } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import type { ResponseTargetView } from '#/contexts/inbox/application/public-api'
import { presentResponseTarget } from './response-target-presentation'

const BADGE_VARIANT = {
  neutral: 'secondary',
  attention: 'outline',
  success: 'secondary',
  muted: 'outline',
} as const

export function ResponseTargetCard({ target }: Readonly<{ target: ResponseTargetView }>) {
  const view = presentResponseTarget(target)
  return (
    <Card aria-label={view.title}>
      <CardHeader className="gap-2 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock3 aria-hidden="true" className="size-4" />
            {view.title}
          </CardTitle>
          <Badge variant={BADGE_VARIANT[view.tone]}>{view.status}</Badge>
        </div>
        <CardDescription>{view.description}</CardDescription>
      </CardHeader>
      {view.dueLabel ? (
        <CardContent className="pt-0 text-sm">
          <span className="text-muted-foreground">Target time: </span>
          <time dateTime={target.dueAt?.toISOString()}>{view.dueLabel}</time>
          <span className="ml-1 text-muted-foreground">({target.propertyTimezone})</span>
        </CardContent>
      ) : null}
    </Card>
  )
}
