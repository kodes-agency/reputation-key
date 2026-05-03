// Organization settings — view and edit organization details
import { createFileRoute } from '@tanstack/react-router'
import { updateOrganization } from '#/contexts/identity/server/organizations'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import { OrganizationSettingsForm } from '#/components/features/organization/OrganizationSettingsForm'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/settings/organization',
)({
  component: OrganizationSettingsPage,
})

function OrganizationSettingsPage() {
  const ctx = Route.useRouteContext()

  const mutation = useMutationAction(updateOrganization, {
    successMessage: 'Organization updated',
  })

  const organization = ctx.activeOrganization

  if (!organization) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Organization Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your organization settings.
          </p>
        </div>
        <div className="rounded-lg border p-4 text-center text-muted-foreground">
          No organization found.
        </div>
      </div>
    )
  }

  const handleSubmit = async (values: {
    name: string
    slug: string
    logo: string | null
    contactEmail: string | null
    billingCompanyName: string | null
    billingAddress: string | null
    billingCity: string | null
    billingPostalCode: string | null
    billingCountry: string | null
  }) => {
    // Convert empty strings to null/undefined for optional fields
    const data = {
      name: values.name,
      slug: values.slug,
      logo: values.logo || undefined, // Better Auth expects undefined, not null
      contactEmail: values.contactEmail || null,
      billingCompanyName: values.billingCompanyName || null,
      billingAddress: values.billingAddress || null,
      billingCity: values.billingCity || null,
      billingPostalCode: values.billingPostalCode || null,
      billingCountry: values.billingCountry || null,
    }
    await mutation({ data })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Organization Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage {organization.name} settings.
        </p>
      </div>

      <OrganizationSettingsForm
        organization={{
          name: organization.name,
          slug: organization.slug,
          logo: undefined,
          contactEmail: organization.contactEmail,
          billingCompanyName: organization.billingCompanyName,
          billingAddress: organization.billingAddress,
          billingCity: organization.billingCity,
          billingPostalCode: organization.billingPostalCode,
          billingCountry: organization.billingCountry,
        }}
        onSubmit={handleSubmit}
        isPending={mutation.isPending}
        error={mutation.error}
      />
    </div>
  )
}
