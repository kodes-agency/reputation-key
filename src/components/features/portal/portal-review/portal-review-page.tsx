// The review page (board A9): before a manager publishes, what guests will see
// change in plain words, what stops the publication or deserves a note, how each
// language stands, and the page after a 1 star and a 5 star rating. The footer
// publishes, as the one button the review read says the server will accept.
//
// Everything is a read (`getPortalReview`, the draft preview); the only write is
// the publish the route hands in. A portal that is live keeps its one quiet
// "Disable public page" action below the lists, which the interim page offered
// and nothing else in the workspace does.

import { useState } from 'react'
import type { Action } from '#/components/hooks/use-action'
import type { PortalReview } from '#/contexts/portal/application/public-api'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { PortalDetailTab } from '../portal-detail/portal-detail-rules'
import type { PortalEditorSection } from '../portal-editor/portal-editor-sections'
import { useNow } from '../portal-history/use-now'
import { PortalPublicationRow } from '../portal-settings/portal-publication-row'
import type { PortalPreviewReader } from '../portal-preview/portal-preview-pane'
import type { PortalData, UpdatePortalVariables } from '../shared/types'
import { describeReviewFooter } from './portal-review-footer'
import { describeWhoCanFix, type FixPerson } from './portal-review-checks'
import type { ReviewChangeLine } from './portal-review-changes'
import { ReviewChanges } from './review-changes'
import { ReviewChecks } from './review-checks'
import { ReviewFooter } from './review-footer'
import { ReviewLanguages } from './review-languages'
import { ReviewPreview, type ReviewPreviewView, type ShowRequest } from './review-preview'
import { ReviewStates } from './review-states'
import { useReviewPreview } from './use-review-preview'

type Props = Readonly<{
  propertyId: string
  portal: PortalData
  review: PortalReview
  /** The property's zone: a change made late in the evening reads as that day's. */
  timeZone: string
  viewerId: string
  /** The people who can put a blocked check right (see `resolveFixPeople`). */
  fixPeople: readonly FixPerson[]
  /** The tab and section the manager came from; "Back to editing" returns to them. */
  tab: PortalDetailTab
  section?: PortalEditorSection
  getPortalPreview: PortalPreviewReader
  onPublish: () => void
  isPublishing: boolean
  /** The portal's own state change, for "Disable public page". */
  updateMutation: Action<UpdatePortalVariables>
  canManage: boolean
}>

export function PortalReviewPage({
  propertyId,
  portal,
  review,
  timeZone,
  viewerId,
  fixPeople,
  tab,
  section,
  getPortalPreview,
  onPublish,
  isPublishing,
  updateMutation,
  canManage,
}: Props) {
  const now = useNow()
  const [chosenLocale, setChosenLocale] = useState<GuestLocale | null>(null)
  const [view, setView] = useState<ReviewPreviewView>({ kind: 'pair' })
  const [shown, setShown] = useState<ShowRequest & { id: string }>()
  const preview = useReviewPreview(portal.id, getPortalPreview, chosenLocale)

  const show = (line: ReviewChangeLine) => {
    if (line.part === null) return
    if (line.locale !== null) setChosenLocale(line.locale)
    setView({ kind: 'pair' })
    setShown((current) => ({
      id: line.id,
      part: line.part ?? 'top',
      nonce: (current?.nonce ?? 0) + 1,
    }))
  }

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <div className="flex min-w-0 flex-col lg:min-h-full lg:w-[34rem] lg:shrink-0 lg:border-r">
        <div className="flex-1 space-y-8 px-4 py-5 md:px-6 md:py-6">
          <ReviewChanges
            review={review}
            now={now}
            timeZone={timeZone}
            shownId={shown?.id ?? null}
            onShow={show}
          />
          <ReviewChecks
            checks={review.checks}
            languages={review.languages}
            propertyId={propertyId}
            portalId={portal.id}
            whoCanFix={describeWhoCanFix(viewerId, fixPeople)}
          />
          <ReviewLanguages languages={review.languages} />
          <ReviewStates
            data={preview}
            view={view}
            onViewChange={setView}
            languageCount={review.languages.length}
          />
          {portal.publicationState === 'published' ? (
            <section aria-labelledby="review-public-page-heading" className="space-y-3">
              <h2 id="review-public-page-heading" className="text-lg font-semibold">
                Public page
              </h2>
              <PortalPublicationRow
                portal={portal}
                mutation={updateMutation}
                canManage={canManage}
              />
            </section>
          ) : null}
        </div>
        <ReviewFooter
          view={describeReviewFooter(review)}
          propertyId={propertyId}
          portalId={portal.id}
          tab={tab}
          section={section}
          isPublishing={isPublishing}
          onPublish={onPublish}
        />
      </div>
      <aside className="min-w-0 flex-1 border-t bg-muted/20 px-4 py-5 md:px-8 lg:sticky lg:top-0 lg:max-h-full lg:self-start lg:overflow-y-auto lg:border-t-0">
        <ReviewPreview
          data={preview}
          view={view}
          onViewChange={setView}
          onLocaleChange={setChosenLocale}
          showRequest={shown ?? null}
        />
      </aside>
    </div>
  )
}
