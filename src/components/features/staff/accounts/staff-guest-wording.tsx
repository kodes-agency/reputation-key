import { FormFieldFrame } from '#/components/forms/form-field-frame'
import { Input } from '#/components/ui/input'
import { Textarea } from '#/components/ui/textarea'
import { SectionTitle } from '#/components/ui/section-title'
import type { StaffAddFormProps } from './staff-add-form'

export function StaffGuestWording({
  wording,
  title,
  shortDescription,
  setTitle,
  setShortDescription,
  busy,
}: Readonly<{
  wording: NonNullable<StaffAddFormProps['wording']>
  title: string
  shortDescription: string
  setTitle: (value: string) => void
  setShortDescription: (value: string) => void
  busy: boolean
}>) {
  if (!wording.canWrite)
    return <p>An account admin has to write this property's guest wording first.</p>
  return (
    <section className="space-y-3" aria-label="Guest wording">
      <SectionTitle>First, what guests will read at this property</SectionTitle>
      <FormFieldFrame id="staff-guest-title" label="Title" invalid={false}>
        <Input
          id="staff-guest-title"
          required
          value={title}
          maxLength={120}
          disabled={busy}
          onChange={(event) => setTitle(event.target.value)}
        />
      </FormFieldFrame>
      <FormFieldFrame id="staff-guest-description" label="Description" invalid={false}>
        <Textarea
          id="staff-guest-description"
          required
          value={shortDescription}
          maxLength={500}
          disabled={busy}
          onChange={(event) => setShortDescription(event.target.value)}
        />
      </FormFieldFrame>
    </section>
  )
}
