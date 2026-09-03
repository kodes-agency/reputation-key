// Intentional out-of-shell experience for dormant beta features and accounts
// awaiting workspace access. Dark routes redirect here instead of rendering a
// partially live shell; access recovery arrives before tenant loaders mount.
import { createFileRoute, Link, useSearch } from '@tanstack/react-router'
import { z } from 'zod/v4'
import { AuthCard } from '#/components/layout/auth-layout'
import { REFUSAL_COPY } from '#/shared/auth/capability-refusal-category'

const unavailableSearch = z.object({
  feature: z.string().optional(),
  reason: z.literal('workspace_access').optional(),
  category: z
    .enum(['not_in_beta', 'needs_admin_enablement', 'temporarily_unavailable'])
    .optional(),
  propertyId: z.string().optional(),
})

type UnavailableSearch = z.infer<typeof unavailableSearch>

type UnavailableLink =
  | Readonly<{
      label: string
      to: '/accept-invitation' | '/dashboard'
    }>
  | Readonly<{
      label: string
      to: '/properties/$propertyId/settings'
      params: Readonly<{ propertyId: string }>
    }>

type UnavailablePageContent = Readonly<{
  title: string
  description: string
  guidance: string | null
  link: UnavailableLink
}>

export function unavailablePageContent({
  feature,
  reason,
  category,
  propertyId,
}: UnavailableSearch): UnavailablePageContent {
  if (reason === 'workspace_access') {
    return {
      title: "Workspace access isn't ready",
      description:
        'Your account is signed in, but it is not connected to an active workspace.',
      guidance:
        'Review any pending invitation. If none is available, ask the person who invited you to confirm your access.',
      link: {
        label: 'Review pending invitations',
        to: '/accept-invitation',
      },
    }
  }

  if (category !== undefined) {
    const copy = REFUSAL_COPY[category]
    const link: UnavailableLink =
      copy.next === 'property_settings' && propertyId
        ? {
            label: 'Open property settings',
            to: '/properties/$propertyId/settings',
            params: { propertyId },
          }
        : { label: 'Back to dashboard', to: '/dashboard' }

    return {
      title: copy.title(feature ?? 'This feature'),
      description: copy.description,
      guidance: null,
      link,
    }
  }

  return {
    title: feature
      ? `${feature} is not available in this beta`
      : 'Not available in this beta',
    description: feature
      ? `${feature} is not part of the current beta experience.`
      : 'This part of the product is disabled for the internal beta.',
    guidance: null,
    link: { label: 'Back to dashboard', to: '/dashboard' },
  }
}

export const Route = createFileRoute('/unavailable')({
  validateSearch: unavailableSearch,
  component: UnavailablePage,
})

function UnavailablePageLink({ link }: Readonly<{ link: UnavailableLink }>) {
  const className = 'text-primary underline underline-offset-4'
  if (link.to === '/properties/$propertyId/settings') {
    return (
      <Link to={link.to} params={link.params} className={className}>
        {link.label}
      </Link>
    )
  }

  return (
    <Link to={link.to} className={className}>
      {link.label}
    </Link>
  )
}

function UnavailablePage() {
  const content = unavailablePageContent(useSearch({ from: '/unavailable' }))
  return (
    <AuthCard title={content.title} description={content.description}>
      {content.guidance && (
        <p className="mb-4 text-center text-sm text-muted-foreground">
          {content.guidance}
        </p>
      )}
      <p className="text-sm">
        <UnavailablePageLink link={content.link} />
      </p>
    </AuthCard>
  )
}
