import { useState } from 'react'
import { Link2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Field, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import type { PortalShareMutations, IssuedPortalLink } from './portal-share-types'

type Props = Readonly<{
  portalId: string
  isPending: boolean
  issueMutation: PortalShareMutations['issueMutation']
  onLinkIssued: (link: IssuedPortalLink) => void
}>

export function PortalLinkIssueForm({
  portalId,
  isPending,
  issueMutation,
  onLinkIssued,
}: Props) {
  const [printBatch, setPrintBatch] = useState('')

  return (
    <form
      className="flex flex-col gap-4 rounded-lg bg-muted/40 p-4"
      onSubmit={(event) => {
        event.preventDefault()
        const normalizedPrintBatch = printBatch.trim()
        void issueMutation({
          data: normalizedPrintBatch
            ? { portalId, printBatch: normalizedPrintBatch }
            : { portalId },
        })
          .then((link) => {
            onLinkIssued({ publicUrl: link.publicUrl })
            setPrintBatch('')
          })
          .catch(() => undefined)
      }}
    >
      <Field data-disabled={isPending || undefined}>
        <FieldLabel htmlFor="portal-print-batch">Print batch (optional)</FieldLabel>
        <Input
          id="portal-print-batch"
          value={printBatch}
          onChange={(event) => setPrintBatch(event.target.value)}
          maxLength={100}
          placeholder="Front desk cards — August"
          disabled={isPending}
        />
        <p className="text-xs text-muted-foreground">
          Add a label when this link will be printed on a specific batch of QR or NFC
          materials.
        </p>
      </Field>
      <Button type="submit" disabled={isPending} className="min-h-11 sm:min-h-9">
        <Link2 data-icon="inline-start" />
        {issueMutation.isPending ? 'Generating…' : 'Generate public link'}
      </Button>
    </form>
  )
}
