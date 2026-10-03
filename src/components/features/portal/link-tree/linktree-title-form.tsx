// "Title on the page": the words above the tiles, per language. Empty means the
// default of the language being written (the pack's "Useful links", "Полезни
// връзки"), so the field shows it as its placeholder. Saves as it is typed, through the portal's autosave.

import { useForm } from '@tanstack/react-form'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import { Button } from '#/components/ui/button'
import { Field, FieldError, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import {
  LINKTREE_TITLE_MAX_LENGTH,
  linktreeDefaultTitle,
  linktreeTitlesFormSchema,
} from '#/contexts/portal/application/dto/portal-linktree.dto'
import type { OfferedGuestLocale } from '#/shared/domain/guest-locale'
import { usePortalFormAutosave } from '../portal-editor/use-portal-form-autosave'
import {
  titlesFormValues,
  toLinktreeTitlesInput,
  type LinktreeTitlesFormValues,
} from './linktree-rules'
import type { LinktreeMutations } from './use-linktree-mutations'

type Props = Readonly<{
  portalId: string
  titles: Readonly<Partial<Record<OfferedGuestLocale, string>>>
  locales: ReadonlyArray<OfferedGuestLocale>
  /** The language being written. */
  locale: OfferedGuestLocale
  save: LinktreeMutations['saveSettings']
  disabled: boolean
}>

export function LinktreeTitleForm({
  portalId,
  titles,
  locales,
  locale,
  save,
  disabled,
}: Props) {
  const defaults: LinktreeTitlesFormValues = titlesFormValues(titles, locales)
  const autosave = usePortalFormAutosave('linktree-title', defaults)
  const form = useForm({
    defaultValues: defaults,
    listeners: autosave.listeners,
    validators: { onSubmit: linktreeTitlesFormSchema },
    onSubmit: async ({ value }) => {
      await save({ data: toLinktreeTitlesInput(portalId, value) })
    },
  })
  const index = Math.max(0, locales.indexOf(locale))
  const defaultTitle = linktreeDefaultTitle(locale)

  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <form.Field name={`titles[${index}].title`}>
        {(field: BaseFieldApi) => {
          const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
          return (
            // The board's row: the label beside the field from `sm` up, and the
            // default with its reset on the line beneath, under the field.
            <Field
              data-invalid={isInvalid}
              className="gap-1.5 sm:grid sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-x-3"
            >
              <FieldLabel htmlFor="linktree-title" className="sm:whitespace-nowrap">
                Title on the page
              </FieldLabel>
              <Input
                id="linktree-title"
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={isInvalid}
                placeholder={defaultTitle}
                maxLength={LINKTREE_TITLE_MAX_LENGTH}
                disabled={disabled}
              />
              {isInvalid ? (
                <div className="sm:col-start-2">
                  <FieldError errors={field.state.meta.errors} />
                </div>
              ) : null}
              <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground sm:col-start-2">
                Default: “{defaultTitle}”, translated for every language.
                {field.state.value === '' ? null : (
                  <Button
                    type="button"
                    variant="link"
                    size="inline"
                    disabled={disabled}
                    onClick={() => field.handleChange('')}
                  >
                    Use default
                  </Button>
                )}
              </p>
            </Field>
          )
        }}
      </form.Field>
    </form>
  )
}
