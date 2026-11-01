// Portal context — goal-readiness facts.
//
// What Reporting's Monthly portal goal needs about a Property's Portals before
// it can recommend a number (ADR 0068): which are live and since when, when
// each was live over the last 60 days, whether its code is made and its QR or
// NFC marker published, and its group. Identifiers, names, states and instants
// only; Reporting decides what they mean (live days, readiness, rows).
//
// Every non-archived Portal of the Property is listed, a draft or a disabled one
// too, in name order. Each source is asked once for that set.
//
// No permission is checked here. This is a cross-context read on
// `PortalPublicApi`, called only by Reporting's use case, which asks
// `goal.create` under `goal.use` and the Property grant first.

import type { PortalRepository } from './ports/portal.repository'
import type { PortalGroupRepository } from './ports/portal-group.repository'
import type { PortalPublicationRepository } from './ports/portal-publication.repository'
import type { PortalTokenRepository } from './ports/portal-token.repository'
import type { Portal } from '../domain/types'
import { liveIntervals, liveRunStart, type LiveInterval } from '../domain/portal-live-run'
import { comparePortalsByName } from './portal-name-order'
import type {
  OrganizationId,
  PortalGroupId,
  PortalId,
  PropertyId,
} from '#/shared/domain/ids'

/** How far back the live intervals reach: the 28-day basis and this month, with room. */
const LIVE_INTERVAL_LOOKBACK_MS = 60 * 24 * 60 * 60 * 1000

type GoalReadinessFact = Readonly<{
  kind?: 'personal'
  portalId: PortalId
  name: string
  skipPrivateRating: boolean
  /**
   * The Portal's stored state. `published` does not by itself mean live: an
   * Organization closing closes the activation and keeps the state, and a guest
   * reaches a Portal only while both hold. Decide "live" from `liveSince` and
   * `liveIntervals`, never from this.
   */
  publicationState: 'draft' | 'published' | 'disabled'
  /** When the current live run began; null when the Portal is not live. */
  liveSince: Date | null
  /** The runs that overlap `[asOf − 60 days, asOf)`, clipped to it, oldest first. */
  liveIntervals: readonly LiveInterval[]
  /** When the code that resolves now was made; null when none does. */
  codeIssuedAt: Date | null
  /** That code has a published QR or NFC marker, so its scans count. */
  codeReady: boolean
  portalGroupId: PortalGroupId | null
}>

export type GoalReadinessFacts = Readonly<{
  portals: readonly GoalReadinessFact[]
  /** Kept for existing consumers; this read includes the complete roster. */
  truncated: boolean
}>

type GoalReadinessFactsDeps = Readonly<{
  portalRepo: Pick<PortalRepository, 'listByProperty'>
  publicationRepo: Pick<PortalPublicationRepository, 'listActivationsForPortals'>
  portalTokenRepo: Pick<PortalTokenRepository, 'findResolvableSummariesForPortals'>
  portalGroupRepo: Pick<PortalGroupRepository, 'listGroupsForPortals'>
}>

type CandidatePortal = Portal &
  Readonly<{ publicationState: 'draft' | 'published' | 'disabled' }>

const isCandidate = (portal: Portal): portal is CandidatePortal =>
  portal.publicationState !== 'archived'

export const createGoalReadinessFacts = (deps: GoalReadinessFactsDeps) => ({
  listGoalReadinessFacts: async (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    asOf: Date,
  ): Promise<GoalReadinessFacts> => {
    const candidates = (await deps.portalRepo.listByProperty(organizationId, propertyId))
      .filter(isCandidate)
      .sort(comparePortalsByName)
    const portals = candidates
    const truncated = false
    if (portals.length === 0) return { portals: [], truncated }

    const portalIds = portals.map((portal) => portal.id)
    const since = new Date(asOf.getTime() - LIVE_INTERVAL_LOOKBACK_MS)
    const [activations, tokens, groups] = await Promise.all([
      deps.publicationRepo.listActivationsForPortals(organizationId, portalIds),
      deps.portalTokenRepo.findResolvableSummariesForPortals(
        organizationId,
        portalIds,
        asOf,
      ),
      deps.portalGroupRepo.listGroupsForPortals(organizationId, portalIds, asOf),
    ])
    const tokenByPortal = new Map(tokens.map((row) => [String(row.portalId), row]))
    const groupByPortal = new Map(groups.map((row) => [String(row.portalId), row.group]))

    return {
      truncated,
      portals: portals.map((portal) => {
        const own = activations.filter((row) => row.portalId === portal.id)
        const code = tokenByPortal.get(portal.id)
        return {
          ...(portal.kind === 'personal' ? { kind: 'personal' as const } : {}),
          portalId: portal.id,
          name: portal.name,
          skipPrivateRating: portal.skipPrivateRating,
          publicationState: portal.publicationState,
          liveSince: liveRunStart(own),
          liveIntervals: liveIntervals(own, since, asOf),
          codeIssuedAt: code?.issuedAt ?? null,
          codeReady: code?.hasPublishedAccessArtifact ?? false,
          portalGroupId: groupByPortal.get(portal.id)?.id ?? null,
        }
      }),
    }
  },
})
