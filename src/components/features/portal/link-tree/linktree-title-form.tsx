// "Title on the page": the words above the tiles, per language. Empty means the
// default of the language being written (the pack's "Useful links", "Полезни
// връзки"), so the field shows it as its placeholder. Saves as it is typed, through the portal's autosave.

import { useForm } from '@tanstack/react-form'
import { FormTextField, type BaseFieldApi } from '#/components/forms/form-text-field'
import { Button } from '#/components/ui/button'
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
    <form onSubmit={(event) => event.preventDefault()} className="space-y-1.5">
      <form.Field name={`titles[${index}].title`}>
        {(field: BaseFieldApi) => (
          <>
            <FormTextField
              field={field}
              label="Title on the page"
              id="linktree-title"
              placeholder={defaultTitle}
              maxLength={LINKTREE_TITLE_MAX_LENGTH}
              disabled={disabled}
            />
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              Default: “{defaultTitle}”.
              {field.state.value === '' ? null : (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  disabled={disabled}
                  onClick={() => field.handleChange('')}
                >
                  Use default
                </Button>
              )}
            </p>
          </>
        )}
      </form.Field>
    </form>
  )
}
