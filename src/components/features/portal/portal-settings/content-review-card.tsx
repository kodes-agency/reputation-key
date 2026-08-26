// Portal content review — the manager entry point for the governed
// `portal.content_review.completed`, `portal.configuration_completeness` and
// `portal.approved_destination_ratio` facts produced from the saved gateway.

import { useState } from 'react'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import type { Action } from '#/components/hooks/use-action'
import { ContentReviewAttestation } from './content-review-attestation'
import { reviewStatusMessage } from './content-review-status'
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
  // before the button will send it. Held here rather than in the attestation
  // branch so an unpublish/republish round trip does not silently clear it.
  const [attested, setAttested] = useState(false)
  // The use case rejects completion for anything but published content
  // (complete-content-review.ts: invalid_publication_transition).
  const isPublished = portal.publicationState === 'published'

  return (
    <div className="space-y-3 rounded-md border px-4 py-3">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Content review</h3>
        <p className="text-xs text-muted-foreground">
          Review the saved gateway details — name, description, appearance, categories and
          destinations — and confirm every destination opens the intended review page.
          Save pending edits before recording the review.
        </p>
      </div>

      <FormErrorBanner error={mutation.error} />

      {isPublished ? (
        <ContentReviewAttestation
          portalId={portal.id}
          mutation={mutation}
          disabled={disabled}
          attested={attested}
          onAttestedChange={setAttested}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          Publish this portal before recording a content review — a review can only attest
          to content guests can actually reach.
        </p>
      )}

      <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
        {reviewStatusMessage(mutation.isPending, mutation.data)}
      </p>
    </div>
  )
}
