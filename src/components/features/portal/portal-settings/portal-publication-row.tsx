// The publication row: which state the portal is in, what that means for
// guests, and the single toggle that flips it. Every one of those three answers
// is a lookup in portal-settings-rules.ts / portal-publication-badge.ts, so this
// stays a description of the row rather than a nest of state comparisons.

import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  PUBLICATION_BADGE_VARIANTS,
  PUBLICATION_LABELS,
} from '../portal-publication-badge'
import { PUBLICATION_DESCRIPTIONS, PUBLICATION_TOGGLES } from './portal-settings-rules'
import type { Action } from '#/components/hooks/use-action'
import type {
  PortalData,
  PortalPublicationState,
  UpdatePortalVariables,
} from '../shared/types'

type Props = Readonly<{
  portal: PortalData
  mutation: Action<UpdatePortalVariables>
  /** Whether the viewer holds `portal.update`. Archival is handled by the rule. */
  canManage: boolean
}>

export function PortalPublicationRow({ portal, mutation, canManage }: Props) {
  const state = portal.publicationState
  return (
    <div className="flex min-h-14 flex-col gap-3 rounded-md border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium">Publication</h3>
          <Badge variant={PUBLICATION_BADGE_VARIANTS[state]}>
            {PUBLICATION_LABELS[state]}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">{PUBLICATION_DESCRIPTIONS[state]}</p>
      </div>
      <PublicationToggleButton
        portalId={portal.id}
        state={state}
        mutation={mutation}
        show={canManage}
      />
    </div>
  )
}

function PublicationToggleButton({
  portalId,
  state,
  mutation,
  show,
}: Readonly<{
  portalId: string
  state: PortalPublicationState
  mutation: Action<UpdatePortalVariables>
  show: boolean
}>) {
  const toggle = PUBLICATION_TOGGLES[state]
  if (!show || toggle === null) return null
  return (
    <Button
      variant={toggle.variant}
      className="min-h-11 sm:min-h-9"
      disabled={mutation.isPending}
      onClick={() => {
        void mutation({
          data: { portalId, publicationState: toggle.nextState },
        }).catch(() => undefined)
      }}
    >
      {mutation.isPending ? 'Updating…' : toggle.label}
    </Button>
  )
}
