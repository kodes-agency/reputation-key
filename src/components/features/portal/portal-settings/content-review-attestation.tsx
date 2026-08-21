// The published-portal branch of the content review card: the human
// attestation checkbox plus the submit button that produces the governed
// `portal.content_review.completed` fact. Split out of content-review-card.tsx
// so each publication state maps to one flat branch.

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Field, FieldLabel } from '#/components/ui/field'
import type { Action } from '#/components/hooks/use-action'
import type { CompleteReviewResult, CompleteReviewVariables } from '../shared/types'

const CHECKBOX_ID = 'portal-content-review-attestation'

type Props = Readonly<{
  portalId: string
  mutation: Action<CompleteReviewVariables, CompleteReviewResult>
  disabled: boolean
  attested: boolean
  onAttestedChange: (attested: boolean) => void
}>

export function ContentReviewAttestation({
  portalId,
  mutation,
  disabled,
  attested,
  onAttestedChange,
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
      <Field orientation="horizontal">
        <Checkbox
          id={CHECKBOX_ID}
          checked={attested}
          disabled={busy}
          onCheckedChange={(next) => onAttestedChange(next === true)}
        />
        <FieldLabel htmlFor={CHECKBOX_ID} className="text-xs font-normal">
          I opened every destination on this portal and confirm each one points at the
          intended review page.
        </FieldLabel>
      </Field>
      <Button
        variant="outline"
        className="min-h-11 sm:min-h-9"
        disabled={busy || !attested}
        onClick={record}
      >
        {mutation.isPending ? 'Recording…' : 'Record content review'}
      </Button>
    </>
  )
}
