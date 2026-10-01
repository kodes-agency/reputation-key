// Portal context — the merged History read (round 4, slice 35a).
//
// One newest-first timeline for a Portal: its creation, every publish and
// restore, every change of health and every public-address event, each with
// the person who did it when one was recorded, including who made an address
// and who downloaded it again. Page edits (who changed the wording or links)
// arrive with the page-edit ledger in slice 35b.
//
// Each source is read with its own "strictly before the cursor" bound and
// limit + 1 rows; the merge keeps the newest `limit`. Authorization is the
// same as the publication history: `portal.read` in the Portal's Property.

import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId, userId as toUserId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PortalRepository } from '../ports/portal.repository'
import type { PortalHealthRepository } from '../ports/portal-health.repository'
import type { PortalHistoryRepository } from '../ports/portal-history.repository'
import type { PortalActorDirectory } from '../ports/portal-actor-directory.port'
import { loadPortalOrThrow } from '../load-accessible-portal'
import {
  HISTORY_KEY_PREFIX,
  classifyCodeIssuance,
  decodeHistoryCursor,
  encodeHistoryCursor,
  historyBoundFor,
  historyCategoriesFor,
  pageHistory,
  type HistoryPosition,
  type PortalHistoryCategory,
  type PortalHistoryDetail,
  type PortalHistoryFilter,
  type PortalHistoryRecord,
} from '../../domain/portal-history'
import type { Portal } from '../../domain/types'

const DEFAULT_HISTORY_PAGE_SIZE = 20
const MAX_HISTORY_PAGE_SIZE = 50

export type PortalHistoryEntry = Readonly<{
  /** Stable for the life of the entry: safe as a list key and as a cursor part. */
  key: string
  category: PortalHistoryCategory
  occurredAt: string
  /** Null for the system, and for facts that recorded no person. */
  actor: Readonly<{ userId: string; displayName: string | null }> | null
  detail: PortalHistoryDetail
}>

export type PortalHistory = Readonly<{
  entries: ReadonlyArray<PortalHistoryEntry>
  /** Opaque; pass it back as `cursor` for the next older page. */
  nextCursor: string | null
}>

export type GetPortalHistoryInput = Readonly<{
  portalId: string
  cursor?: string
  limit?: number
  filter?: PortalHistoryFilter
}>

type Deps = Readonly<{
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
  historyRepo: PortalHistoryRepository
  healthRepo: PortalHealthRepository
  actorDirectory: PortalActorDirectory
}>

const clampLimit = (requested: number | undefined): number =>
  requested !== undefined && Number.isSafeInteger(requested)
    ? Math.min(MAX_HISTORY_PAGE_SIZE, Math.max(1, requested))
    : DEFAULT_HISTORY_PAGE_SIZE

function createdRecord(
  portal: Portal,
  position: HistoryPosition | null,
): readonly PortalHistoryRecord[] {
  const record: PortalHistoryRecord = {
    key: `${HISTORY_KEY_PREFIX.created}${portal.id}`,
    at: portal.createdAt,
    category: 'publishing',
    actorUserId: portal.createdBy,
    detail: { kind: 'portal_created' },
  }
  const bound = historyBoundFor(HISTORY_KEY_PREFIX.created, position)
  if (bound === null || record.at < bound.at) return [record]
  const tied = record.at.getTime() === bound.at.getTime() && bound.inclusive
  return tied && (bound.afterId === null || portal.id < bound.afterId) ? [record] : []
}

export const getPortalHistory =
  (deps: Deps) =>
  async (input: GetPortalHistoryInput, ctx: AuthContext): Promise<PortalHistory> => {
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.read',
      forbiddenMessage: 'Insufficient permissions to view Portal history',
    })
    const limit = clampLimit(input.limit)
    const position = input.cursor ? decodeHistoryCursor(input.cursor) : null
    const categories = new Set(historyCategoriesFor(input.filter ?? 'all'))
    const { organizationId } = ctx
    const { propertyId } = portal
    // One extra row per source proves there is an older page without a count.
    const take = limit + 1
    const page = (prefix: string, idless = false) => ({
      bound: historyBoundFor(prefix, position, idless),
      limit: take,
    })

    const [publications, issuances, downloads, revocations, health] = await Promise.all([
      categories.has('publishing')
        ? deps.historyRepo.listPublicationEvents(
            organizationId,
            propertyId,
            portal.id,
            page(HISTORY_KEY_PREFIX.publication),
          )
        : [],
      categories.has('codes')
        ? deps.historyRepo.listCodeIssuances(
            organizationId,
            propertyId,
            portal.id,
            page(HISTORY_KEY_PREFIX.codeIssued),
          )
        : [],
      categories.has('codes')
        ? deps.historyRepo.listCodeDownloads(
            organizationId,
            propertyId,
            portal.id,
            page(HISTORY_KEY_PREFIX.codeDownloaded),
          )
        : [],
      categories.has('codes')
        ? deps.historyRepo.listCodeRevocations(
            organizationId,
            propertyId,
            portal.id,
            page(HISTORY_KEY_PREFIX.codeRevoked, true),
          )
        : [],
      categories.has('health')
        ? deps.healthRepo.listHistory(
            organizationId,
            propertyId,
            portal.id,
            take,
            historyBoundFor(HISTORY_KEY_PREFIX.health, position),
          )
        : [],
    ])

    const records: PortalHistoryRecord[] = [
      ...(categories.has('publishing') ? createdRecord(portal, position) : []),
      ...publications.map((row): PortalHistoryRecord => ({
        key: `${HISTORY_KEY_PREFIX.publication}${row.activationId}`,
        at: row.activatedAt,
        category: 'publishing',
        actorUserId: row.activatedBy,
        detail: {
          kind: row.kind === 'rollback' ? 'version_restored' : 'version_published',
          version: row.version,
        },
      })),
      ...issuances.map((row): PortalHistoryRecord => ({
        key: `${HISTORY_KEY_PREFIX.codeIssued}${row.tokenId}`,
        at: row.issuedAt,
        category: 'codes',
        actorUserId: row.issuedBy,
        detail: classifyCodeIssuance(row, row.predecessor),
      })),
      ...downloads.map((row): PortalHistoryRecord => ({
        key: `${HISTORY_KEY_PREFIX.codeDownloaded}${row.downloadId}`,
        at: row.downloadedAt,
        category: 'codes',
        actorUserId: row.downloadedBy,
        detail: { kind: 'code_downloaded', version: row.version, purpose: row.purpose },
      })),
      ...revocations.map((row): PortalHistoryRecord => ({
        key: `${HISTORY_KEY_PREFIX.codeRevoked}${row.revokedAt.getTime()}`,
        at: row.revokedAt,
        category: 'codes',
        actorUserId: row.revokedBy,
        detail: { kind: 'codes_revoked', reason: row.reason },
      })),
      ...health.map((row): PortalHistoryRecord => ({
        key: `${HISTORY_KEY_PREFIX.health}${row.id}`,
        at: row.effectiveFrom,
        category: 'health',
        actorUserId: null,
        detail: { kind: 'health_changed', status: row.status, reason: row.reason },
      })),
    ]

    const merged = pageHistory(records, limit)
    const actorIds = [
      ...new Set(
        merged.records.flatMap((record) =>
          record.actorUserId === null ? [] : [record.actorUserId],
        ),
      ),
    ]
    const names = await deps.actorDirectory.resolveDisplayNames(
      organizationId,
      actorIds.map(toUserId),
    )

    return {
      entries: merged.records.map((record) => ({
        key: record.key,
        category: record.category,
        occurredAt: record.at.toISOString(),
        actor:
          record.actorUserId === null
            ? null
            : {
                userId: record.actorUserId,
                displayName: names.get(toUserId(record.actorUserId)) ?? null,
              },
        detail: record.detail,
      })),
      nextCursor: merged.next ? encodeHistoryCursor(merged.next) : null,
    }
  }

export type GetPortalHistory = ReturnType<typeof getPortalHistory>
