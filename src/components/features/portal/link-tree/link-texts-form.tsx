// A tile's words in one language: the label, and the optional line under it. The
// form holds every language the Portal offers, so switching the tab never loses
// an edit, and it saves as it is typed through the portal's autosave
// (portal-editor/use-portal-form-autosave.ts).

import { useForm } from '@tanstack/react-form'
import {
  LINK_TEXT_LABEL_MAX_LENGTH,
  LINK_TEXT_LINE_MAX_LENGTH,
  linkTextsFormSchema,
} from '#/contexts/portal/application/dto/portal-linktree.dto'
import type { PortalLinktreeLink } from '#/contexts/portal/application/public-api'
import { FormTextField, type BaseFieldApi } from '#/components/forms/form-text-field'
import { FieldGroup } from '#/components/ui/field'
import {
  GUEST_LOCALE_METADATA,
  type GuestLocale,
  type OfferedGuestLocale,
} from '#/shared/domain/guest-locale'
import { usePortalFormAutosave } from '../portal-editor/use-portal-form-autosave'
import {
  describeUnsavedLine,
  requiredTextLocales,
  textsFormValues,
  toLinkTextsInput,
} from './linktree-rules'
import type { LinktreeMutations } from './use-linktree-mutations'

type Props = Readonly<{
  link: PortalLinktreeLink
  /** Every offered language of the Portal, primary first. */
  locales: ReadonlyArray<OfferedGuestLocale>
  primaryLocale: GuestLocale
  /** The language being written. */
  locale: OfferedGuestLocale
  save: LinktreeMutations['saveTexts']
  disabled: boolean
}>

export function LinkTextsForm({
  link,
  locales,
  primaryLocale,
  locale,
  save,
  disabled,
}: Props) {
  const defaults = textsFormValues(link, locales)
  const autosave = usePortalFormAutosave(`link-texts:${link.id}`, defaults)
  const form = useForm({
    defaultValues: defaults,
    listeners: autosave.listeners,
    validators: {
      onSubmit: linkTextsFormSchema(requiredTextLocales(link, primaryLocale)),
    },
    onSubmit: async ({ value }) => {
      const input = toLinkTextsInput(link.id, value)
      if (input.texts.length > 0) await save({ data: input })
    },
  })
  const index = Math.max(0, locales.indexOf(locale))
  const fieldId = `link-${link.id}-${locale}`
  const isFallback = locale !== primaryLocale

  return (
    // The write is the coordinator's, so Enter must not also submit natively.
    <form onSubmit={(event) => event.preventDefault()}>
      <FieldGroup className="gap-4">
        <form.Field name={`texts[${index}].label`}>
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              label="Label"
              id={`${fieldId}-label`}
              maxLength={LINK_TEXT_LABEL_MAX_LENGTH}
              disabled={disabled}
            />
          )}
        </form.Field>
        <form.Subscribe
          selector={(state) => ({
            label: state.values.texts[index]?.label ?? '',
            line: state.values.texts[index]?.line ?? '',
          })}
        >
          {(text) => {
            const unsaved = describeUnsavedLine(text)
            const fallback =
              isFallback && text.label.trim() === ''
                ? `${GUEST_LOCALE_METADATA[locale].englishName}-speaking guests see it in ${GUEST_LOCALE_METADATA[primaryLocale].englishName} until you add it.`
                : null
            const message = unsaved ?? fallback
            return message === null ? null : (
              <p className="text-sm text-warn" role="status">
                {message}
              </p>
            )
          }}
        </form.Subscribe>
        <form.Field name={`texts[${index}].line`}>
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              label="Line under the label"
              optional
              id={`${fieldId}-line`}
              maxLength={LINK_TEXT_LINE_MAX_LENGTH}
              disabled={disabled}
            />
          )}
        </form.Field>
      </FieldGroup>
    </form>
  )
}
