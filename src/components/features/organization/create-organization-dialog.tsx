import { useForm } from '@tanstack/react-form'
import { useRef } from 'react'
import { z } from 'zod/v4'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { FormTextField } from '#/components/forms/form-text-field'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import type { Action } from '#/components/hooks/use-action'
import { FormErrorBanner } from '#/components/forms/form-error-banner'

const createOrgSchema = z.object({
  name: z.string().min(1, 'Organization name is required'),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, and hyphens'),
})

type CreateOrganizationDialogProps = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  createOrg: Action<{ data: { name: string; slug: string } }>
}>

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

export function CreateOrganizationDialog({
  open,
  onOpenChange,
  onSuccess,
  createOrg,
}: CreateOrganizationDialogProps) {
  const previousNameRef = useRef('')

  const form = useForm({
    defaultValues: {
      name: '',
      slug: '',
    },
    validators: { onSubmit: createOrgSchema },
    onSubmit: async ({ value }) => {
      await createOrg({
        data: { name: value.name.trim(), slug: value.slug.trim() },
      })
      onSuccess()
      form.reset()
      previousNameRef.current = ''
    },
  })

  function handleOpenChange(open: boolean) {
    if (!open) {
      form.reset()
      previousNameRef.current = ''
    }
    onOpenChange(open)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Organization</DialogTitle>
          <DialogDescription>
            Create a new organization to manage your properties and team.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            form.handleSubmit()
          }}
        >
          {/* Hidden subscriber to auto-sync slug from name */}
          <form.Subscribe selector={(state) => state.values.name}>
            {(name) => {
              if (name !== previousNameRef.current) {
                previousNameRef.current = name
                const slugged = slugify(name)
                form.setFieldValue('slug', slugged)
              }
              return null
            }}
          </form.Subscribe>

          <div className="grid gap-4 py-4">
            <form.Field name="name">
              {(field: BaseFieldApi) => (
                <FormTextField
                  field={field}
                  label="Organization Name"
                  id="org-name"
                  placeholder="Acme Corporation"
                />
              )}
            </form.Field>
            <form.Field name="slug">
              {(field: BaseFieldApi) => (
                <FormTextField
                  field={field}
                  label="Slug"
                  id="org-slug"
                  placeholder="acme-corporation"
                />
              )}
            </form.Field>
            <FormErrorBanner error={createOrg.error} />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createOrg.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createOrg.isPending}>
              {createOrg.isPending ? 'Creating...' : 'Create Organization'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
