// Portal context — the Review & publish read (round 4, slice 31).
//
// Everything the review page needs before a manager publishes: what guests
// will see change (each change with the person and the time), what stops the
// publication or deserves a note, how each language stands, and the number the
// version will get. It writes nothing. The rules live in the domain
// (`portal-review-rules.ts`); this reads the facts they take, from the same
// sources the publish use case reads, so the page cannot show a button the
// server would refuse. Authorization is `portal.read` in the Portal's
// Property, like the other editor reads; publishing is `publishPortalChanges`.
//
// What counts as a change. The page-edit ledger names each part of the page a
// person changed since the live version was published (the live one, which a
// restore can make older than the newest), with the wording
// before and after; the pending-change fence says which published inputs moved.
// An open fence row with no ledger row of its kind is still listed, with the
// person it records. A live version of the earlier design, or one pinned to a
// Google address the Property has since left, is listed as such: publishing
// fixes both.

import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId as toPortalId } from '#/shared/domain/ids'
import { canForContext } from '#/shared/domain/permissions'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type {
  PropertyGoogleReviewDestinationPublicApi,
  PropertyLifecyclePublicApi,
} from '#/contexts/property/application/public-api'
import type { PortalRepository } from '../ports/portal.repository'
import {
  MAX_HISTORY_SOURCE_ROWS,
  type PortalHistoryRepository,
} from '../ports/portal-history.repository'
import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { PortalExperienceRepository } from '../ports/portal-experience.repository'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'
import type { PortalTokenRepository } from '../ports/portal-token.repository'
import type { PortalActorDirectory } from '../ports/portal-actor-directory.port'
import { loadPortalOrThrow } from '../load-accessible-portal'
import {
  findVerifiedGoogleReviewDestination,
  portalHasPublicAddress,
  portalHasResponsibleManager,
  propertyAllowsPublication,
} from '../portal-publication-readiness'
import {
  destinationMatchesSnapshot,
  workingCopyMatchesSnapshot,
} from '../portal-working-copy-match'
import {
  namedVersionActor,
  resolveVersionActors,
  versionActor,
  type PortalVersionActor,
} from '../portal-version-actors'
import { readPortalLanguageCoverage } from './get-portal-language-coverage'
import { portalError } from '../../domain/errors'
import { IMMERSIVE_HUB_SCHEMA_VERSION } from '../../domain/portal-publication-snapshot'
import { resolvePortalPublication } from '../../domain/portal-publication-source'
import type { PortalPublicationSource } from '../../domain/portal-publication-source'
import type {
  PortalPageEditKind,
  PortalPageEditSubject,
} from '../../domain/portal-page-edit'
import {
  buildReviewChanges,
  evaluateReviewChecks,
  reviewLanguageRows,
  type ReviewChange,
  type ReviewCheck,
  type ReviewLanguageRow,
} from '../../domain/portal-review-rules'
import type { Portal } from '../../domain/types'

/**
 * The ledger is read newest first, one repository page at most. Asking for
 * exactly the repository's cap keeps `changesMayBeIncomplete` honest: a page
 * that comes back this full may have left older rows behind.
 */
const PAGE_EDIT_READ_LIMIT = MAX_HISTORY_SOURCE_ROWS

export type PortalReviewChange =
  | Readonly<{
      type: 'edit'
      kind: PortalPageEditKind
      subject: PortalPageEditSubject
      /** The look and welcome text belong to every Portal of the Property. */
      propertyWide: boolean
      actor: PortalVersionActor | null
      occurredAt: string
      previousText: string | null
      newText: string | null
      /** How many saves this change stands for. */
      editCount: number
    }>
  | Readonly<{
      type: 'unrecorded'
      kind: PortalPageEditKind
      actor: PortalVersionActor | null
      occurredAt: string
    }>
  | Readonly<{ type: 'earlier_design' }>
  | Readonly<{ type: 'google_destination_moved' }>
  | Readonly<{ type: 'unlisted' }>
  | Readonly<{ type: 'no_visible_change' }>

export type PortalReview = Readonly<{
  portalId: string
  publicationState: Portal['publicationState']
  /**
   * What the primary button does: `publish` takes a Portal that is not live
   * live, `publish_changes` replaces the live version, `none` is a Portal that
   * cannot be published (archived).
   */
  action: 'publish' | 'publish_changes' | 'none'
  /** The version guests see now; null while the Portal is not live. */
  live: Readonly<{
    version: number
    activatedAt: string
    activatedBy: PortalVersionActor
  }> | null
  /** The number the new version gets if published now. */
  publishesAsVersion: number
  /** The live version already says what the draft says and nothing is open. */
  nothingToPublish: boolean
  /**
   * No check is blocked, there is something to publish, and the viewer may
   * publish it (the button the page shows is one the server will accept).
   */
  canPublish: boolean
  /** Oldest first; empty for a Portal that is not live. */
  changes: readonly PortalReviewChange[]
  /** The ledger page was full of newer edits, so older ones may be missing from `changes`. */
  changesMayBeIncomplete: boolean
  /** Blocked first, then warnings, then the checks that passed. */
  checks: readonly ReviewCheck[]
  checkCounts: Readonly<{ blocked: number; warning: number; passed: number }>
  languages: readonly ReviewLanguageRow[]
}>

export type GetPortalReviewDeps = Readonly<{
  portalRepo: PortalRepository
  portalLinkRepo: PortalLinkRepository
  experienceRepo: Pick<
    PortalExperienceRepository,
    'getPropertyExperience' | 'listPortalOverrides'
  >
  publicationRepo: Pick<
    PortalPublicationRepository,
    | 'loadWorkingCopy'
    | 'getCursor'
    | 'listActivationHistoryPage'
    | 'listOpenPendingContentChanges'
  >
  historyRepo: Pick<PortalHistoryRepository, 'listPageEdits'>
  actorDirectory: PortalActorDirectory
  portalTokenRepo: Pick<PortalTokenRepository, 'findResolvableSummaryForPortal'>
  propertyGoogleReviewDestinationApi: PropertyGoogleReviewDestinationPublicApi
  propertyLifecycleApi: PropertyLifecyclePublicApi
  staffPublicApi: StaffPublicApi
  clock: () => Date
}>

function actionFor(state: Portal['publicationState']): PortalReview['action'] {
  if (state === 'published') return 'publish_changes'
  return state === 'archived' ? 'none' : 'publish'
}

/** Texts per language that began as an AI draft and were not written over since. */
function aiDraftCounts(
  source: PortalPublicationSource,
): Readonly<Partial<Record<GuestLocale, number>>> {
  const counts: Partial<Record<GuestLocale, number>> = {}
  for (const link of source.links) {
    for (const [locale, text] of Object.entries(link.texts)) {
      if (text?.provenance !== 'ai_draft') continue
      const key = locale as GuestLocale
      counts[key] = (counts[key] ?? 0) + 1
    }
  }
  return counts
}

const actorIdsOf = (change: ReviewChange): readonly (string | null)[] =>
  change.type === 'edit' || change.type === 'unrecorded' ? [change.actorUserId] : []

function viewOf(
  change: ReviewChange,
  names: ReadonlyMap<string, string>,
): PortalReviewChange {
  const actor = (id: string | null) => versionActor(id, names)
  switch (change.type) {
    case 'edit':
      return {
        type: 'edit',
        kind: change.kind,
        subject: change.subject,
        propertyWide: change.propertyWide,
        actor: actor(change.actorUserId),
        occurredAt: change.occurredAt.toISOString(),
        previousText: change.previousText,
        newText: change.newText,
        editCount: change.editCount,
      }
    case 'unrecorded':
      return {
        type: 'unrecorded',
        kind: change.kind,
        actor: actor(change.actorUserId),
        occurredAt: change.occurredAt.toISOString(),
      }
    default:
      return change
  }
}

export const getPortalReview =
  (deps: GetPortalReviewDeps) =>
  async (
    input: Readonly<{
      portalId: string
      /**
       * Whether the publish capability is open for this Portal, as the server
       * function found it; the use case cannot see the capability gate. Defaults
       * to open: the role's own `portal.update` is always checked here.
       */
      mayPublish?: boolean
    }>,
    ctx: AuthContext,
  ): Promise<PortalReview> => {
    const pid = toPortalId(input.portalId)
    const portal = await loadPortalOrThrow(deps, ctx, pid, {
      permission: 'portal.read',
      forbiddenMessage: 'Insufficient permissions to review Portal changes',
    })
    const { organizationId } = ctx
    const { propertyId } = portal
    const isLive = portal.publicationState === 'published'
    const at = deps.clock()

    const [
      workingCopy,
      cursor,
      openChanges,
      activations,
      destination,
      propertyActive,
      hasPublicAddress,
      coverage,
      ledger,
    ] = await Promise.all([
      deps.publicationRepo.loadWorkingCopy(organizationId, pid),
      deps.publicationRepo.getCursor(organizationId, pid),
      deps.publicationRepo.listOpenPendingContentChanges?.(
        organizationId,
        propertyId,
        pid,
      ) ?? Promise.resolve([]),
      deps.publicationRepo.listActivationHistoryPage(organizationId, propertyId, pid, {
        beforeSequence: null,
        limit: 1,
      }),
      findVerifiedGoogleReviewDestination(deps, organizationId, portal),
      propertyAllowsPublication(deps, organizationId, portal),
      portalHasPublicAddress(deps, ctx, portal, at),
      readPortalLanguageCoverage(deps, organizationId, portal),
      isLive
        ? deps.historyRepo.listPageEdits(
            organizationId,
            propertyId,
            pid,
            { bound: null, limit: PAGE_EDIT_READ_LIMIT },
            portal.createdAt,
          )
        : Promise.resolve([]),
    ])
    if (!workingCopy) {
      throw portalError(
        'publication_snapshot_unavailable',
        'Portal publication content is unavailable',
      )
    }
    const liveRecord = activations.current
    if (isLive && !liveRecord) {
      throw portalError(
        'publication_snapshot_unavailable',
        'This Portal has no live version to replace',
      )
    }

    const resolution = resolvePortalPublication(workingCopy)
    const checks = evaluateReviewChecks({
      propertyActive,
      googleDestinationVerified: destination !== null,
      hasResponsibleManager: portalHasResponsibleManager(portal),
      hasPublicAddress,
      blockers: resolution.blockers,
      warnings: resolution.warnings,
    })

    // What is live, and how the draft stands against it. A Portal that is not
    // live has no live version to differ from, so it has no change list.
    const liveSnapshot = isLive && liveRecord ? liveRecord.snapshot : null
    const destinationMoved =
      liveSnapshot !== null &&
      destination !== null &&
      !destinationMatchesSnapshot(destination, liveSnapshot)
    const workingCopyDiffers =
      liveSnapshot !== null && !workingCopyMatchesSnapshot(workingCopy, liveSnapshot)
    // The same question `publishPortalChanges` asks before it publishes nothing.
    const nothingToPublish =
      liveSnapshot !== null &&
      openChanges.length === 0 &&
      !destinationMoved &&
      !workingCopyDiffers

    // Edits the live version already took are not changes: a publication takes
    // every edit made up to the instant it is committed. The baseline is the
    // live version's own time, not the newest version's: a restore can put an
    // older version live, and everything the draft holds since then reaches
    // guests when it is published. The ledger never spans an activation
    // (rollbacks included), so rows after this instant start from the live wording.
    const baseline = liveSnapshot?.createdAt ?? null
    const unpublished =
      baseline === null ? [] : ledger.filter((row) => row.occurredAt > baseline)
    const changes: readonly ReviewChange[] =
      liveSnapshot === null
        ? []
        : buildReviewChanges({
            edits: unpublished,
            pending: openChanges,
            liveIsEarlierDesign:
              liveSnapshot.configuration.schemaVersion !== IMMERSIVE_HUB_SCHEMA_VERSION,
            destinationMoved,
            workingCopyDiffers,
          })
    const changesMayBeIncomplete =
      ledger.length >= PAGE_EDIT_READ_LIMIT && unpublished.length === ledger.length

    const names = await resolveVersionActors(deps.actorDirectory, organizationId, [
      liveRecord?.activation.activatedBy ?? null,
      ...changes.flatMap(actorIdsOf),
    ])
    const action = actionFor(portal.publicationState)

    return {
      portalId: portal.id,
      publicationState: portal.publicationState,
      action,
      live:
        liveRecord === null
          ? null
          : {
              version: liveRecord.snapshot.version,
              activatedAt: liveRecord.activation.activatedAt.toISOString(),
              activatedBy: namedVersionActor(liveRecord.activation.activatedBy, names),
            },
      publishesAsVersion: cursor.nextSnapshotVersion,
      nothingToPublish,
      canPublish:
        checks.canPublish &&
        action !== 'none' &&
        !nothingToPublish &&
        (input.mayPublish ?? true) &&
        canForContext(ctx, 'portal.update'),
      changes: changes.map((change) => viewOf(change, names)),
      changesMayBeIncomplete,
      checks: checks.checks,
      checkCounts: {
        blocked: checks.blockedCount,
        warning: checks.warningCount,
        passed: checks.passedCount,
      },
      languages: reviewLanguageRows(coverage, aiDraftCounts(workingCopy)),
    }
  }

export type GetPortalReview = ReturnType<typeof getPortalReview>
