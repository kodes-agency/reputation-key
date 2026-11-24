import type { PortalLinkId } from '#/shared/domain/ids'
import type { PortalPublicApi } from '#/contexts/portal/public-api'
import { trace } from '#/shared/observability/trace'

type PublicPortal = Extract<
  Awaited<ReturnType<PortalPublicApi['findPublicPortalByToken']>>,
  { status: 'found' }
>['result']

export type ResolvePortalLinkDeps = Readonly<{
  findPublicPortalByToken: PortalPublicApi['findPublicPortalByToken']
}>

export type ResolvePortalLinkInput = Readonly<{
  token: string
  linkId: PortalLinkId
}>

export type ResolvePortalLinkResult = Readonly<{ url: string }> | null

/**
 * A link ID can never widen the token's scope: it must be present in the
 * published data of the Portal the token resolved to.
 */
export const findPortalLink = (
  portal: Pick<PublicPortal, 'links'>,
  linkId: string,
): Readonly<{ url: string }> | null =>
  portal.links.find((candidate) => candidate.id === linkId) ?? null

/**
 * Navigation only: the GET redirect never creates product analytics.
 */
export const resolvePortalLink =
  (deps: ResolvePortalLinkDeps) =>
  async (input: ResolvePortalLinkInput): Promise<ResolvePortalLinkResult> => {
    const outcome = await trace('publicPortal.findByToken', () =>
      deps.findPublicPortalByToken(input.token),
    )
    if (outcome.status !== 'found') return null
    const link = findPortalLink(outcome.result, input.linkId)
    return link ? { url: link.url } : null
  }
