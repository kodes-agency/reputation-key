// Portal content review — the only producer of the governed
// `portal.content_review.completed`, `portal.configuration_completeness` and
// `portal.approved_destination_ratio` facts that badges, goals and leaderboards
// read. `completeContentReview` shipped fully wired but with no caller, so those
// three recognition metrics could never be produced through the product; this is
// that entry point.

import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, FieldLabel } from '#/components/ui/field'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import type { Action } from '#/components/hooks/use-action'
import type {
  CompleteReviewResult,
  CompleteReviewVariables,
  PortalData,
} from '../shared/types'

type Props = Readonly<{
  portal: PortalData
  mutation: Action<CompleteReviewVariables, CompleteReviewResult>
  disabled: boolean
}>

export function ContentReviewCard({ portal, mutation, disabled }: Props) {
  // The fact asserts a human act, so the manager has to make the assertion
  // before the button will send it.
  const [attested, setAttested] = useState(false)
  // The use case rejects completion for anything but published content
  // (complete-content-review.ts: invalid_publication_transition).
  const isPublished = portal.publicationState === 'published'

  return (
    <div className="space-y-3 rounded-md border px-4 py-3">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Content review</h3>
        <p className="text-xs text-muted-foreground">
          Records the portal configuration as currently saved — name, description,
          accent colour, categories and destination URLs. Badges, goals and
          leaderboards count these reviews, so save pending edits before recording
          one.
        </p>
      </div>

      <FormErrorBanner error={mutation.error} />

      {isPublished ? (
        <>
          <Field orientation="horizontal">
            <Checkbox
              id="portal-content-review-attestation"
              checked={attested}
              disabled={disabled || mutation.isPending}
              onCheckedChange={(next) => setAttested(next === true)}
            />
            <FieldLabel
              htmlFor="portal-content-review-attestation"
              className="text-xs font-normal"
            >
              I opened every destination on this portal and confirm each one points at the
              intended review page.
            </FieldLabel>
          </Field>
          <Button
            variant="outline"
            className="min-h-11 sm:min-h-9"
            disabled={disabled || !attested || mutation.isPending}
            onClick={() => {
              // reviewId is the idempotency key the fact store hashes into its
              // event ids, so each distinct review act needs a fresh one. Only
              // revision 1 is reachable from here: a correction must name the
              // three superseded event ids, which no read surface exposes.
              void mutation({
                data: {
                  portalId: portal.id,
                  reviewId: crypto.randomUUID(),
                  revision: 1,
                },
              })
                .then(() => setAttested(false))
                .catch(() => undefined)
            }}
          >
            {mutation.isPending ? 'Recording…' : 'Record content review'}
          </Button>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Publish this portal before recording a content review — a review can only
          attest to content guests can actually reach.
        </p>
      )}

      <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
        {mutation.isPending
          ? 'Recording content review'
          : mutation.data?.status === 'recorded'
            ? 'Content review recorded.'
            : mutation.data?.status === 'duplicate'
              ? 'That review was already recorded.'
              : ''}
      </p>
    </div>
  )
}
