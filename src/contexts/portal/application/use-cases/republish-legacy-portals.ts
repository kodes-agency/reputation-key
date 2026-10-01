// Portal context — republish every live v1/v2 Portal as the Immersive Hub.
//
// A Portal published before the writer switched to schema version 3 (slice 19)
// keeps serving its old page until it is published again, and the legacy guest
// renderer can only be removed once none is left. This is the operator's way of
// publishing them all: for each live Portal whose active version is schema 1 or
// 2, the ordinary "publish changes while live" use case runs, so the readiness
// gates, the content, the new version, the closing of the previous activation as
// `replaced` and the facts are exactly what a manager's own publication gives.
// The only difference is the actor: the named operator (`ops:<operator>`).
//
// A legacy Portal always reads as "pending" (its live page is an older design),
// so the publication would put the Portal's whole working copy live, including
// anything its manager has edited and not yet published. The operator must not
// push a manager's drafts live by accident, so a Portal with open unpublished
// edits is skipped (`pending_edits`) unless the run is told to include them.
//
// Selection comes from the live version, never from a Portal's history: a Portal
// that is draft-only, disabled, archived or deleted has no live version and is
// never read, so it is never touched. A Portal that is not ready is skipped with
// the reason the gates gave and the rest carry on. The run is idempotent: a
// republished Portal is on schema 3 and no longer selected, and a skipped one
// reports the same reason again until it is fixed (or the manager publishes or
// discards the edits). Output is identifiers, versions and reason codes only.

import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { isPortalError, type PortalErrorCode } from '../../domain/errors'
import { opsPublicationContext } from '../portal-ops-actor'
import {
  MAX_LEGACY_PORTAL_PAGE,
  type LegacyLivePortal,
  type PortalLegacyPublicationReader,
} from '../ports/portal-legacy-publication.reader'
import type { PreviewPortalChanges, PublishPortalChanges } from './publish-portal-changes'

export type RepublishLegacyPortalsDeps = Readonly<{
  reader: PortalLegacyPublicationReader
  publishPortalChanges: PublishPortalChanges
  previewPortalChanges: PreviewPortalChanges
  logger: LoggerPort
}>

export type RepublishLegacyPortalsInput = Readonly<{
  organizationId: OrganizationId
  /** Narrow to one Property; absent means every Property of the organisation. */
  propertyId?: PropertyId
  operatorId: string
  /** Report what would happen and write nothing. */
  dryRun: boolean
  /**
   * Publish a Portal even though its manager has unpublished edits (they go
   * live with the upgrade). Off by default: such a Portal is skipped.
   */
  includePendingEdits?: boolean
  /** How many Portals are read at a time (at most the reader's page limit). */
  pageSize: number
}>

type RowScope = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  fromVersion: number
  fromSchemaVersion: 1 | 2
}>

export type RepublishSkipCode = PortalErrorCode | 'pending_edits'

export type RepublishLegacyPortalRow = RowScope &
  (
    | Readonly<{
        outcome: 'republished' | 'would_republish'
        toVersion: number
        /** Unpublished manager edits that went (or would go) live with it. */
        pendingEdits: number
      }>
    /** Nothing was pending, which a live earlier design never reads as. */
    | Readonly<{ outcome: 'unchanged' }>
    /**
     * Left alone: the gates refused it (not ready, or changed under the run), or
     * its manager has unpublished edits. Run again once fixed.
     */
    | Readonly<{
        outcome: 'skipped'
        reason: Readonly<{ code: RepublishSkipCode; message: string }>
      }>
    /** A fault that was not a Portal refusal; the run stopped here. */
    | Readonly<{ outcome: 'failed' }>
  )

export type RepublishLegacyPortalsReport = Readonly<{
  mode: 'dry_run' | 'apply'
  rows: ReadonlyArray<RepublishLegacyPortalRow>
  totals: Readonly<{
    /** Portals visited: after a halt, fewer than the run would have selected. */
    processed: number
    republished: number
    wouldRepublish: number
    skipped: number
    unchanged: number
    failed: number
  }>
  /** Set when the run stopped early at a fault that is not a Portal refusal. */
  halted: Readonly<{ portalId: PortalId; fault: string }> | null
}>

type Outcome = RepublishLegacyPortalRow['outcome']

const totalsOf = (
  rows: ReadonlyArray<RepublishLegacyPortalRow>,
): RepublishLegacyPortalsReport['totals'] => {
  const count = (outcome: Outcome) => rows.filter((row) => row.outcome === outcome).length
  return {
    processed: rows.length,
    republished: count('republished'),
    wouldRepublish: count('would_republish'),
    skipped: count('skipped'),
    unchanged: count('unchanged'),
    failed: count('failed'),
  }
}

const pendingEditsReason = (
  count: number,
): { code: 'pending_edits'; message: string } => ({
  code: 'pending_edits',
  message: `${count} unpublished ${count === 1 ? 'edit' : 'edits'}; the manager should publish or discard ${count === 1 ? 'it' : 'them'}`,
})

const scopeOf = (portal: LegacyLivePortal): RowScope => ({
  organizationId: portal.organizationId,
  propertyId: portal.propertyId,
  portalId: portal.portalId,
  fromVersion: portal.liveVersion,
  fromSchemaVersion: portal.liveSchemaVersion,
})

export const republishLegacyPortals =
  (deps: RepublishLegacyPortalsDeps) =>
  async (input: RepublishLegacyPortalsInput): Promise<RepublishLegacyPortalsReport> => {
    // Built first: an operator that cannot be recorded stops the run before a read.
    const ctx = opsPublicationContext(input.organizationId, input.operatorId)
    const rows: RepublishLegacyPortalRow[] = []
    let halted: RepublishLegacyPortalsReport['halted'] = null

    const handle = async (
      portal: LegacyLivePortal,
    ): Promise<RepublishLegacyPortalRow> => {
      const scope = scopeOf(portal)
      const request = { portalId: String(portal.portalId) }
      try {
        // Always plan first: it asks the gates, and counts the manager's edits.
        const previewed = await deps.previewPortalChanges(request, ctx)
        if (previewed.outcome === 'unchanged') return { ...scope, outcome: 'unchanged' }
        const { pendingEdits } = previewed
        if (pendingEdits > 0 && input.includePendingEdits !== true) {
          return {
            ...scope,
            outcome: 'skipped',
            reason: pendingEditsReason(pendingEdits),
          }
        }
        if (input.dryRun) {
          return {
            ...scope,
            outcome: 'would_republish',
            toVersion: previewed.version,
            pendingEdits,
          }
        }
        const published = await deps.publishPortalChanges(request, ctx)
        return published.outcome === 'published'
          ? {
              ...scope,
              outcome: 'republished',
              toVersion: published.version,
              pendingEdits,
            }
          : { ...scope, outcome: 'unchanged' }
      } catch (error) {
        if (!isPortalError(error)) {
          // The report names the Portal (a log object may not carry its id) and
          // keeps identifiers only; the cause goes to the log.
          deps.logger.error(
            { error },
            'republish-legacy-portals stopped at a fault that is not a Portal refusal',
          )
          halted = {
            portalId: portal.portalId,
            fault: error instanceof Error ? error.name : 'unknown',
          }
          return { ...scope, outcome: 'failed' }
        }
        return {
          ...scope,
          outcome: 'skipped',
          reason: { code: error.code, message: error.message },
        }
      }
    }

    // A page the reader would cut short must not read as the last one.
    const pageSize = Math.min(Math.max(1, input.pageSize), MAX_LEGACY_PORTAL_PAGE)
    let after: PortalId | null = null
    while (halted === null) {
      const page = await deps.reader.listLiveLegacyPortals({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        afterPortalId: after,
        limit: pageSize,
      })
      for (const portal of page) {
        rows.push(await handle(portal))
        if (halted !== null) break
      }
      const last = page.at(-1)
      if (last === undefined || page.length < pageSize) break
      after = last.portalId
    }

    return {
      mode: input.dryRun ? 'dry_run' : 'apply',
      rows,
      totals: totalsOf(rows),
      halted,
    }
  }

export type RepublishLegacyPortals = ReturnType<typeof republishLegacyPortals>
