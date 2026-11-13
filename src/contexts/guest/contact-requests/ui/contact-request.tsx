// fallow-ignore-file unused-file
// Mounted only when contact requests launch; until then nothing imports this.
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { DescriptionList, DescriptionItem } from '#/components/ui/description-list'
import type { ContactRequestContact } from '../contracts'

/** The words the manager reads. Held here until the approved copy is final. */
export const MANAGER_CONTACT_REQUEST_COPY = Object.freeze({
  title: 'This guest asked to be contacted',
  body: 'Details are hidden until you reveal them. Revealing is recorded with your name and time. Use them only to answer this feedback.',
  reveal: 'Reveal contact',
  revealing: 'Revealing…',
  revealFailed:
    'The contact details could not be shown. They may have been withdrawn or expired.',
  email: 'Email',
  name: 'Name',
})

export type ManagerContactRequestView = Readonly<{
  maskedContact: string
  submittedAt: string
  expiresAt: string
}>

export function ManagerContactRequest({
  request,
  revealed,
  pending,
  failed,
  onReveal,
}: Readonly<{
  /** The masked request for this feedback; null when the guest asked for none. */
  request: ManagerContactRequestView | null
  revealed: ContactRequestContact | null
  pending: boolean
  failed: boolean
  onReveal: () => void
}>) {
  if (request === null) return null
  return (
    <section aria-labelledby="contact-request-title" className="grid gap-3">
      <h3 id="contact-request-title" className="text-sm font-medium">
        {MANAGER_CONTACT_REQUEST_COPY.title}
      </h3>
      <p className="text-sm text-muted-foreground">{MANAGER_CONTACT_REQUEST_COPY.body}</p>
      {revealed === null ? (
        <>
          <p className="text-sm" aria-label="Hidden contact details">
            {request.maskedContact}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            pending={pending}
            pendingLabel={MANAGER_CONTACT_REQUEST_COPY.revealing}
            onClick={onReveal}
          >
            {MANAGER_CONTACT_REQUEST_COPY.reveal}
          </Button>
        </>
      ) : (
        <DescriptionList stacked aria-label="Contact details">
          <DescriptionItem term={MANAGER_CONTACT_REQUEST_COPY.email}>
            {revealed.email}
          </DescriptionItem>
          {revealed.name !== undefined && (
            <DescriptionItem term={MANAGER_CONTACT_REQUEST_COPY.name}>
              {revealed.name}
            </DescriptionItem>
          )}
        </DescriptionList>
      )}
      {failed && (
        <Alert variant="destructive">
          <AlertTitle>{MANAGER_CONTACT_REQUEST_COPY.title}</AlertTitle>
          <AlertDescription>{MANAGER_CONTACT_REQUEST_COPY.revealFailed}</AlertDescription>
        </Alert>
      )}
    </section>
  )
}
