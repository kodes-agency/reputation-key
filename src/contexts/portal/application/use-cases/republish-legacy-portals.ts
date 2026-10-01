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
// Selection comes from the live version, never from a Portal's history: a Portal
// that is draft-only, disabled, archived or deleted has no live version and is
// never read, so it is never touched. A Portal that is not ready is skipped with
// the reason the gates gave and the rest carry on. The run is idempotent: a
// republished Portal is on schema 3 and no longer selected, and a skipped one
// reports the same reason again until it is fixed. Output is identifiers,
// versions and Portal error codes only.

import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import { isPortalError, type PortalErrorCode } from '../../domain/errors'
import { opsPublicationContext } from '../portal-ops-actor'
import type {
  LegacyLivePortal,
  PortalLegacyPublicationReader,
} from '../ports/portal-legacy-publication.reader'
import type { PreviewPortalChanges, PublishPortalChanges } from './publish-portal-changes'

export type RepublishLegacyPortalsDeps = Readonly<{
  reader: PortalLegacyPublicationReader
  publishPortalChanges: PublishPortalChanges
  previewPortalChanges: PreviewPortalChanges
}>

export type RepublishLegacyPortalsInput = Readonly<{
  organizationId: OrganizationId
  /** Narrow to one Property; absent means every Property of the organisation. */
  propertyId?: PropertyId
  operatorId: string
  /** Report what would happen and write nothing. */
  dryRun: boolean
  /** How many Portals are read at a time. */
  pageSize: number
}>

type RowScope = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  fromVersion: number
  fromSchemaVersion: 1 | 2
}>

export type RepublishLegacyPortalRow = RowScope &
  (
    | Readonly<{ outcome: 'republished' | 'would_republish'; toVersion: number }>
    /** Nothing was pending, which a live earlier design never reads as. */
    | Readonly<{ outcome: 'unchanged' }>
    /** The gates refused it: not ready, or changed under the run. Run again once fixed. */
    | Readonly<{
        outcome: 'skipped'
        reason: Readonly<{ code: PortalErrorCode; message: string }>
      }>
    /** A fault that was not a Portal refusal; the run stopped here. */
    | Readonly<{ outcome: 'failed' }>
  )

export type RepublishLegacyPortalsReport = Readonly<{
  mode: 'dry_run' | 'apply'
  rows: ReadonlyArray<RepublishLegacyPortalRow>
  totals: Readonly<{
    selected: number
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
    selected: rows.length,
    republished: count('republished'),
    wouldRepublish: count('would_republish'),
    skipped: count('skipped'),
    unchanged: count('unchanged'),
    failed: count('failed'),
  }
}

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
        if (input.dryRun) {
          const previewed = await deps.previewPortalChanges(request, ctx)
          return previewed.outcome === 'would_publish'
            ? { ...scope, outcome: 'would_republish', toVersion: previewed.version }
            : { ...scope, outcome: 'unchanged' }
        }
        const published = await deps.publishPortalChanges(request, ctx)
        return published.outcome === 'published'
          ? { ...scope, outcome: 'republished', toVersion: published.version }
          : { ...scope, outcome: 'unchanged' }
      } catch (error) {
        if (!isPortalError(error)) {
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

    let after: PortalId | null = null
    while (halted === null) {
      const page = await deps.reader.listLiveLegacyPortals({
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        afterPortalId: after,
        limit: input.pageSize,
      })
      for (const portal of page) {
        rows.push(await handle(portal))
        if (halted !== null) break
      }
      const last = page.at(-1)
      if (last === undefined || page.length < input.pageSize) break
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
