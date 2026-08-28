import { Link2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
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
  return (
    <div className="flex flex-col gap-4 rounded-lg bg-muted/40 p-4">
      <p className="text-sm text-muted-foreground">
        Generate separate QR and NFC addresses for this portal. Use another portal when
        you need separate attribution or goals.
      </p>
      <Button
        type="button"
        disabled={isPending}
        className="min-h-11 sm:min-h-9"
        onClick={() => {
          void issueMutation({ data: { portalId } })
            .then((link) => {
              onLinkIssued(link)
            })
            .catch(() => undefined)
        }}
      >
        <Link2 data-icon="inline-start" />
        {issueMutation.isPending ? 'Generating…' : 'Generate public link'}
      </Button>
    </div>
  )
}
