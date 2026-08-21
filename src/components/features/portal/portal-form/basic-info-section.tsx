import { useState } from 'react'
import { FieldGroup, Field, FieldLabel } from '#/components/ui/field'
import { FormTextField } from '#/components/forms/form-text-field'
import { FormTextarea } from '#/components/forms/form-textarea'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { AlertTriangle } from 'lucide-react'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import type { BaseFieldApiTextarea } from '#/components/forms/form-textarea'
import type { FormWithField } from '#/components/forms/form-with-field'

type PortalBasicInfoFormValues = {
  name: string
  slug: string
  description: string
}

type Props = Readonly<{
  form: FormWithField<PortalBasicInfoFormValues>
  /** The slug as persisted, to detect divergence and to offer a revert. */
  persistedSlug: string
  disabled?: boolean
}>

export function BasicInfoSection({ form, persistedSlug, disabled }: Props) {
  // The slug is the public URL segment and is chosen once at creation. It was
  // previously not rendered at all, so a typo could never even be seen. It stays
  // read-only until the manager explicitly asks to change it.
  const [slugUnlocked, setSlugUnlocked] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <h3 className="font-semibold">Basic Info</h3>
      <FieldGroup>
        <form.Field name="name">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              label="Name"
              id="edit-portal-name"
              disabled={disabled}
            />
          )}
        </form.Field>

        <form.Field name="slug">
          {(field: BaseFieldApi) =>
            slugUnlocked ? (
              <div className="flex flex-col gap-2">
                <FormTextField
                  field={field}
                  label="URL slug"
                  id="edit-portal-slug"
                  autoComplete="off"
                  disabled={disabled}
                />
                {field.state.value !== persistedSlug && (
                  <Alert variant="destructive">
                    <AlertTriangle className="size-4" />
                    <AlertDescription>
                      Printed QR codes and issued guest links resolve by token, not by
                      slug, so they keep working. Any link that spells out{' '}
                      <span className="font-mono">{persistedSlug}</span> — hand-typed
                      URLs, bookmarks, links pasted into listings — will stop resolving.
                    </AlertDescription>
                  </Alert>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  disabled={disabled}
                  onClick={() => {
                    field.handleChange(persistedSlug)
                    setSlugUnlocked(false)
                  }}
                >
                  Keep {persistedSlug}
                </Button>
              </div>
            ) : (
              <Field>
                <FieldLabel htmlFor="edit-portal-slug-display">URL slug</FieldLabel>
                <div className="flex min-h-9 flex-wrap items-center gap-3">
                  <output
                    id="edit-portal-slug-display"
                    className="font-mono text-sm break-all"
                  >
                    {field.state.value}
                  </output>
                  {!disabled && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSlugUnlocked(true)}
                    >
                      Change slug
                    </Button>
                  )}
                </div>
              </Field>
            )
          }
        </form.Field>

        <form.Field name="description">
          {(field: BaseFieldApiTextarea) => (
            <FormTextarea
              field={field}
              label="Description"
              id="edit-portal-description"
              rows={3}
              disabled={disabled}
            />
          )}
        </form.Field>
      </FieldGroup>
    </div>
  )
}
