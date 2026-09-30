// The review page's body until the full review lands (plain-words change list,
// the 1-star and 5-star previews, the checks, and the publish footer). It gives
// "Review & publish" a working destination now: the publication state and the
// one publish or pause action, exactly as Settings offered them.

import type { Action } from '#/components/hooks/use-action'
import type { PortalPublicationHistory } from '#/contexts/portal/application/public-api'
import { PortalPublicationRow } from '../portal-settings/portal-publication-row'
import { PortalSavedSettingsStatus } from '../portal-settings/portal-saved-settings-status'
import type { PortalData, UpdatePortalVariables } from '../shared/types'

type Props = Readonly<{
  portal: PortalData
  publicationHistory: PortalPublicationHistory
  mutation: Action<UpdatePortalVariables>
  canManage: boolean
}>

export function PortalReviewPage({
  portal,
  publicationHistory,
  mutation,
  canManage,
}: Props) {
  return (
    <section className="space-y-4" aria-labelledby="portal-review-heading">
      <div className="space-y-1">
        <h2 id="portal-review-heading" className="text-lg font-semibold">
          Publication
        </h2>
        <PortalSavedSettingsStatus history={publicationHistory} />
      </div>
      <PortalPublicationRow portal={portal} mutation={mutation} canManage={canManage} />
    </section>
  )
}
