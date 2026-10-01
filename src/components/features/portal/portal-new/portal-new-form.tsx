// New portal — the form: name, group, languages and what to start from. It
// creates a draft; nothing is public until the portal is published.
import { useForm } from '@tanstack/react-form'
import { useRef } from 'react'
import { EyeOff } from 'lucide-react'
import { submitHandler } from '#/components/forms/form-submit'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { SubmitButton } from '#/components/forms/submit-button'
import { Button } from '#/components/ui/button'
import { newPortalFormSchema } from '#/contexts/portal/application/dto/create-portal.dto'
import type { PortalNewData } from './portal-new-types'
import { PortalNewGroupField } from './portal-new-group-field'
import { PortalNewLanguagesField } from './portal-new-languages-field'
import { PortalNewNameField } from './portal-new-name-field'
import { PortalNewResponsible } from './portal-new-responsible'
import { PortalNewStartFromField } from './portal-new-start-from-field'
import { languagesAfterChange } from './portal-new-follow-source'
import { newPortalDefaults, toCreatePortalInput } from './portal-new-rules'

export function PortalNewForm({
  data,
  onCancel,
}: Readonly<{ data: PortalNewData; onCancel: () => void }>) {
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
      <FormErrorBanner error={mutation.error} />
      <form.Field name="name">
        {(field) => <PortalNewNameField field={field} disabled={pending} />}
      </form.Field>
      <form.Field name="groupId">
        {(field) => (
          <PortalNewGroupField field={field} groups={data.groups} disabled={pending} />
        )}
      </form.Field>
      <form.Field name="guestLocales">
        {(field) => (
          <PortalNewLanguagesField
            field={field}
            defaults={options.defaultGuestLocales}
            disabled={pending}
            onEdited={() => {
              languagesEdited.current = true
            }}
          />
        )}
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
      <div className="flex flex-col-reverse items-start gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <EyeOff aria-hidden="true" className="size-4 shrink-0" />
          Nothing is public until you publish.
        </p>
        <div className="flex gap-2 self-end">
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <SubmitButton mutation={mutation} form={form}>
            Create draft
          </SubmitButton>
        </div>
      </div>
    </form>
  )
}
