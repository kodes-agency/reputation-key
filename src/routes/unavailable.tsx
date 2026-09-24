// Intentional out-of-shell experience for dormant beta features and accounts
// awaiting workspace access. Dark routes redirect here instead of rendering a
// partially live shell; access recovery arrives before tenant loaders mount.
import { createFileRoute, Link, useLoaderData, useSearch } from '@tanstack/react-router'
import { z } from 'zod/v4'
import { AuthCard } from '#/components/layout/auth-layout'
import { REFUSAL_COPY } from '#/shared/auth/capability-refusal-category'
import { getAccountAccessRemovalFn } from '#/contexts/feed/server/notifications'

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
      to: '/accept-invitation' | '/properties'
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

/** What the page knows about the reader beyond the URL. */
export type UnavailableAccountState = Readonly<{
  /** Their access to a workspace was removed (I27); false while unknown. */
  accessRemoved: boolean
}>

export function unavailablePageContent(
  { feature, reason, category, propertyId }: UnavailableSearch,
  account: UnavailableAccountState = { accessRemoved: false },
): UnavailablePageContent {
  if (reason === 'workspace_access') {
    // Two very different people reach this screen. One is waiting for a first
    // invitation; the other was removed, and the notice that said so was
    // written into a workspace they can no longer open, so until now the
    // product told them their access "isn't ready" and left them waiting for
    // something that is not coming.
    if (account.accessRemoved) {
      return {
        title: 'Your workspace access was removed',
        description:
          'An account administrator removed your account from the workspace, so it is no longer available to you.',
        guidance:
          'If you think that was a mistake, ask an account administrator of that workspace to invite you again. Any new invitation will appear here.',
        link: {
          label: 'Review pending invitations',
          to: '/accept-invitation',
        },
      }
    }
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
        : { label: 'Back to properties', to: '/properties' }

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
    link: { label: 'Back to properties', to: '/properties' },
  }
}

/**
 * Only the workspace-access screen asks, and a failed read degrades to the
 * waiting-for-an-invitation copy: this page is the recovery surface for an
 * account with no workspace, so it has to render without a working read
 * rather than fail into an error boundary.
 */
export async function resolveUnavailableAccountState(
  reason: UnavailableSearch['reason'],
  readAccessRemoval: () => Promise<Readonly<{ removedAt: string }> | null>,
): Promise<UnavailableAccountState> {
  if (reason !== 'workspace_access') return { accessRemoved: false }
  try {
    return { accessRemoved: (await readAccessRemoval()) !== null }
  } catch {
    return { accessRemoved: false }
  }
}

export const Route = createFileRoute('/unavailable')({
  validateSearch: unavailableSearch,
  loaderDeps: ({ search }) => ({ reason: search.reason }),
  loader: ({ deps }) =>
    resolveUnavailableAccountState(deps.reason, getAccountAccessRemovalFn),
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
  const content = unavailablePageContent(
    useSearch({ from: '/unavailable' }),
    useLoaderData({ from: '/unavailable' }),
  )
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
