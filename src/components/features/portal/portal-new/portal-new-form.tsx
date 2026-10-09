// New portal — the form: name, what to start from, group, languages and who is
// responsible. What to start from comes before the languages, because a copy
// brings its languages with it. It creates a draft; nothing is public until the
// portal is published.
import { useForm } from '@tanstack/react-form'
import { useRef } from 'react'
import { EyeOff } from 'lucide-react'
import { submitHandler } from '#/components/forms/form-submit'
import { DialogErrorBanner } from '#/components/forms/dialog-error-banner'
import { SubmitButton } from '#/components/forms/submit-button'
import { DialogCancel, DialogFooter } from '#/components/ui/dialog'
import { newPortalFormSchema } from '#/contexts/portal/application/dto/create-portal.dto'
import type { PortalNewData } from './portal-new-types'
import { PortalNewGroupField } from './portal-new-group-field'
import { PortalNewLanguagesField } from './portal-new-languages-field'
import { PortalNewNameField } from './portal-new-name-field'
import { PortalNewResponsible } from './portal-new-responsible'
import { PortalNewStartFromField } from './portal-new-start-from-field'
import { copiedLanguagesNote, languagesAfterChange } from './portal-new-follow-source'
import { newPortalDefaults, toCreatePortalInput } from './portal-new-rules'

export function PortalNewForm({ data }: Readonly<{ data: PortalNewData }>) {
  const { options, propertyId, propertyName, mutation } = data
  // Once the person has chosen languages themselves, a copied portal no longer replaces them.
  const languagesEdited = useRef(false)
  const form = useForm({
    defaultValues: newPortalDefaults(options),
    validators: { onSubmit: newPortalFormSchema },
    onSubmit: async ({ value }) => {
      await mutation({ data: toCreatePortalInput(propertyId, value) })
    },
  })
  const follow = (startFrom: 'property' | 'portal', sourcePortalId: string) => {
    form.setFieldValue('startFrom', startFrom)
    form.setFieldValue('sourcePortalId', sourcePortalId)
    if (languagesEdited.current) return
    form.setFieldValue(
      'guestLocales',
      languagesAfterChange(options, data.sources, startFrom, sourcePortalId),
    )
  }
  const pending = mutation.isPending

  return (
    <form onSubmit={submitHandler(form)} className="flex flex-col gap-5" noValidate>
      <form.Field name="name">
        {(field) => <PortalNewNameField field={field} disabled={pending} />}
      </form.Field>
      <form.Field name="startFrom">
        {(startFrom) => (
          <form.Field name="sourcePortalId">
            {(source) => (
              <PortalNewStartFromField
                propertyName={propertyName}
                sources={data.sources}
                startFrom={startFrom.state.value}
                sourcePortalId={source.state.value}
                sourceError={
                  source.state.meta.isTouched && !source.state.meta.isValid
                    ? (source.state.meta.errors[0]?.message ?? null)
                    : null
                }
                disabled={pending}
                onStartFromChange={(next) => follow(next, source.state.value)}
                onSourceChange={(next) => follow('portal', next)}
              />
            )}
          </form.Field>
        )}
      </form.Field>
      <form.Field name="groupId">
        {(field) => (
          <PortalNewGroupField field={field} groups={data.groups} disabled={pending} />
        )}
      </form.Field>
      <form.Subscribe
        selector={(state) =>
          copiedLanguagesNote(
            data.sources,
            state.values.startFrom,
            state.values.sourcePortalId,
            languagesEdited.current,
          )
        }
      >
        {(copiedNote) => (
          <form.Field name="guestLocales">
            {(field) => (
              <PortalNewLanguagesField
                field={field}
                defaults={options.defaultGuestLocales}
                disabled={pending}
                copiedNote={copiedNote}
                onEdited={() => {
                  languagesEdited.current = true
                }}
              />
            )}
          </form.Field>
        )}
      </form.Subscribe>
      <form.Field name="responsibleManagerUserIds">
        {(field) => (
          <PortalNewResponsible
            propertyName={propertyName}
            options={options}
            creatorId={data.creatorId}
            members={data.members}
            choice={field.state.value}
            disabled={pending}
            onChoiceChange={field.handleChange}
          />
        )}
      </form.Field>
      <DialogErrorBanner error={mutation.error} />
      <DialogFooter
        className="border-t pt-4"
        note={
          <>
            <EyeOff aria-hidden="true" className="size-4 shrink-0" />
            Nothing is public until you publish.
          </>
        }
      >
        <DialogCancel />
        <SubmitButton mutation={mutation} form={form}>
          Create draft
        </SubmitButton>
      </DialogFooter>
    </form>
  )
}
