// Intentional out-of-shell experience for dormant beta features and accounts
// awaiting workspace access. Dark routes redirect here instead of rendering a
// partially live shell; access recovery arrives before tenant loaders mount.
import { createFileRoute, Link, useSearch } from '@tanstack/react-router'
import { z } from 'zod/v4'
import { AuthCard } from '#/components/layout/auth-layout'

const unavailableSearch = z.object({
  feature: z.string().optional(),
  reason: z.literal('workspace_access').optional(),
})

type UnavailableSearch = z.infer<typeof unavailableSearch>

type UnavailablePageContent = Readonly<{
  title: string
  description: string
  guidance: string | null
  link: Readonly<{
    label: string
    to: '/home' | '/accept-invitation'
  }>
}>

export function unavailablePageContent({
  feature,
  reason,
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

  return {
    title: feature
      ? `${feature} is not available in this beta`
      : 'Not available in this beta',
    description: feature
      ? `${feature} is not part of the current beta experience.`
      : 'This part of the product is disabled for the internal beta.',
    guidance: null,
    link: { label: 'Back to home', to: '/home' },
  }
}

export const Route = createFileRoute('/unavailable')({
  validateSearch: unavailableSearch,
  component: UnavailablePage,
})

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
        <Link to={content.link.to} className="text-primary underline underline-offset-4">
          {content.link.label}
        </Link>
      </p>
    </AuthCard>
  )
}
