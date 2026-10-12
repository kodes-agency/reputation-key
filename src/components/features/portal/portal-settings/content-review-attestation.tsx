// The published-portal branch of the link check card: the human attestation
// checkbox plus the submit button that produces the governed
// `portal.content_review.completed` fact. Split out of content-review-card.tsx
// so each publication state maps to one flat branch.

import { Button } from '#/components/ui/button'
import { ConsentCheckbox } from '#/components/forms/consent-checkbox'
import type { Action } from '#/components/hooks/use-action'
import type { CompleteReviewResult, CompleteReviewVariables } from '../shared/types'
import { FormErrorBanner } from '#/components/forms/form-error-banner'

const CHECKBOX_ID = 'portal-content-review-attestation'

type Props = Readonly<{
  portalId: string
  mutation: Action<CompleteReviewVariables, CompleteReviewResult>
  disabled: boolean
  attested: boolean
  onAttestedChange: (attested: boolean) => void
  /** The page checked, by name ("live version 5"). */
  live: string
}>

export function ContentReviewAttestation({
  portalId,
  mutation,
  disabled,
  attested,
  onAttestedChange,
  live,
}: Props) {
  const busy = disabled || mutation.isPending

  function record() {
    // reviewId is the idempotency key the fact store hashes into its event
    // ids, so each distinct review act needs a fresh one. Only revision 1 is
    // reachable from here: a correction must name the three superseded event
    // ids, which no read surface exposes.
    void mutation({
      data: { portalId, reviewId: crypto.randomUUID(), revision: 1 },
    })
      .then(() => onAttestedChange(false))
      .catch(() => undefined)
  }

  return (
    <>
      <ConsentCheckbox
        id={CHECKBOX_ID}
        checked={attested}
        disabled={busy}
        onCheckedChange={onAttestedChange}
      >
        I opened the Google link and every Linktree link on {live}, and each one opens the
        page it should.
      </ConsentCheckbox>
      <FormErrorBanner error={mutation.error} />
      <Button variant="outline" disabled={busy || !attested} onClick={record}>
        {mutation.isPending ? 'Recording…' : 'Record the link check'}
      </Button>
    </>
  )
}
