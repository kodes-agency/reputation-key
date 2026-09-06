import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { useEffect } from 'react'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { BasicInfoSection } from './basic-info-section'
import { PortalFeedbackThresholdField } from './portal-feedback-threshold-field'
import type { Action } from '#/components/hooks/use-action'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { updatePortalInputSchema } from '#/contexts/portal/application/dto/update-portal.dto'
import type {
  FormLike,
  PortalData,
  PortalThemeDraft,
  UpdatePortalVariables,
} from '../shared/types'

const editFormSchema = updatePortalInputSchema
  .pick({
    name: true,
    slug: true,
    description: true,
    privateFeedbackThreshold: true,
  })
  .required()
  .extend({
    description: z.string().max(500),
  })
type FormValues = z.infer<typeof editFormSchema>
type Props = Readonly<{
  portal: PortalData
  mutation: Action<UpdatePortalVariables>
  theme: PortalThemeDraft
  disabled?: boolean
  formRef?: React.RefObject<FormLike | null>
}>
export function EditPortalForm({
  portal,
  mutation,
  theme,
  disabled = false,
  formRef,
}: Props) {
  const { can } = usePermissions()
  const isDisabled = disabled || !can('portal.update')

  const form = useForm({
    defaultValues: {
      name: portal.name,
      slug: portal.slug,
      description: portal.description ?? '',
      privateFeedbackThreshold: portal.privateFeedbackThreshold,
    } satisfies FormValues,
    validators: {
      onSubmit: editFormSchema,
    },
    onSubmit: async ({ value }) => {
      const data = {
        portalId: portal.id,
        name: value.name,
        slug: value.slug,
        description: value.description || null,
        theme,
        privateFeedbackThreshold: value.privateFeedbackThreshold,
      }
      await mutation({ data })
    },
  })

  // Publish the external Save handle after render and remove it on unmount.
  useEffect(() => {
    if (!formRef) return
    formRef.current = {
      handleSubmit: () => void form.handleSubmit(),
      // Value-based so undoing every edit clears the unsaved warning.
      hasUnsavedChanges: () => !form.state.isDefaultValue,
    }
    return () => {
      formRef.current = null
    }
  }, [form, formRef])

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
      className="flex flex-col gap-6"
    >
      <FormErrorBanner error={mutation.error} />

      <BasicInfoSection form={form} persistedSlug={portal.slug} disabled={isDisabled} />

      <form.Field name="privateFeedbackThreshold">
        {(field) => (
          <PortalFeedbackThresholdField
            field={field}
            id="edit-private-feedback-threshold"
            disabled={isDisabled}
            description="Controls when optional private feedback appears after the private rating. It never changes access to the Google review action."
          />
        )}
      </form.Field>
    </form>
  )
}
