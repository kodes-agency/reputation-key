import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import type { AuthContext } from '#/shared/domain/auth-context'
import { sha256Hex } from '#/shared/domain/sha256'
import { activityError } from '../../domain/errors'
import {
  createOperationalActionRecord,
  type OperationalAction,
  type OperationalActionHistoryRecordId,
  type OperationalActionRecord,
  type OperationalActionResourceType,
} from '../../domain/operational-action-history'
import type {
  OperationalActionHistoryCursor,
  OperationalActionHistoryPage,
  OperationalActionHistoryQuery,
  OperationalActionHistoryStore,
} from '../../ports/operational-action-history-store.port'

export type OperationalHistoryAccessAuthority = Readonly<{
  isCurrentAccountAdmin(
    input: Readonly<{
      organizationId: string
      userId: string
    }>,
  ): Promise<boolean>
}>

export type OperationalActionHistoryAccessDeps = Readonly<{
  store: OperationalActionHistoryStore
  accessAuthority: OperationalHistoryAccessAuthority
  clock: () => Date
  idGen: () => OperationalActionHistoryRecordId
}>

export type OperationalActionHistoryAccessInput = Readonly<{
  propertyId?: OperationalActionHistoryQuery['propertyId']
  action?: OperationalAction
  resourceType?: OperationalActionResourceType
  cursor?: OperationalActionHistoryCursor
  limit?: number
}>

const boundedLimit = (value: number | undefined, maximum: number): number =>
  Math.min(maximum, Math.max(1, Math.trunc(value ?? 50)))

const accessRecord = (
  deps: OperationalActionHistoryAccessDeps,
  ctx: AuthContext,
  action: 'operational_history.accessed' | 'operational_history.exported',
  outcome: OperationalActionRecord['outcome'],
  reasonCode: string | null,
): OperationalActionRecord => {
  const id = deps.idGen()
  const at = deps.clock()
  const created = createOperationalActionRecord({
    id,
    organizationId: ctx.organizationId,
    propertyId: null,
    actorType: 'user',
    actorId: ctx.userId,
    action,
    outcome,
    resourceType: 'operational_history',
    resourceId: id,
    reasonCode,
    provenance: {
      kind: 'history_access',
      id: `access:${id}`,
      eventType: null,
      eventVersion: null,
      sourceContext: null,
      sourceAggregateId: null,
    },
    occurredAt: at,
    recordedAt: at,
  })
  if (created.isErr()) throw created.error
  return created.value
}

const assertAccess = async (
  deps: OperationalActionHistoryAccessDeps,
  ctx: AuthContext,
  action: 'operational_history.accessed' | 'operational_history.exported',
): Promise<void> => {
  let currentAccountAdmin = false
  let authorityFailed = false
  try {
    currentAccountAdmin = await deps.accessAuthority.isCurrentAccountAdmin({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
    })
  } catch {
    authorityFailed = true
  }
  if (currentAccountAdmin) return

  await deps.store.append(
    accessRecord(
      deps,
      ctx,
      action,
      authorityFailed ? 'failed' : 'denied',
      authorityFailed ? 'authority_unavailable' : 'not_current_account_admin',
    ),
  )
  throw activityError(
    authorityFailed
      ? 'operational_history_unavailable'
      : 'operational_history_access_denied',
    authorityFailed
      ? 'Operational Action History access authority is unavailable'
      : 'Operational Action History is restricted to current AccountAdmins',
  )
}

const queryFor = (
  input: OperationalActionHistoryAccessInput,
  ctx: AuthContext,
  maximum: number,
  observedAt: Date,
): OperationalActionHistoryQuery => ({
  organizationId: ctx.organizationId,
  ...(input.propertyId ? { propertyId: input.propertyId } : {}),
  ...(input.action ? { action: input.action } : {}),
  ...(input.resourceType ? { resourceType: input.resourceType } : {}),
  ...(input.cursor ? { cursor: input.cursor } : {}),
  limit: boundedLimit(input.limit, maximum),
  observedAt,
})

const read = async (
  deps: OperationalActionHistoryAccessDeps,
  input: OperationalActionHistoryAccessInput,
  ctx: AuthContext,
  action: 'operational_history.accessed' | 'operational_history.exported',
  maximum: number,
): Promise<
  Readonly<{ page: OperationalActionHistoryPage; query: OperationalActionHistoryQuery }>
> => {
  await assertAccess(deps, ctx, action)
  const observedAt = deps.clock()
  const query = queryFor(input, ctx, maximum, observedAt)
  try {
    const page = await deps.store.readWithAccess({
      query,
      accessRecord: accessRecord(deps, ctx, action, 'succeeded', null),
    })
    return { page, query }
  } catch {
    await deps.store.append(
      accessRecord(deps, ctx, action, 'failed', 'authority_store_unavailable'),
    )
    throw activityError(
      'operational_history_unavailable',
      'Operational Action History is unavailable',
    )
  }
}

export const listOperationalActionHistory =
  (deps: OperationalActionHistoryAccessDeps) =>
  async (
    input: OperationalActionHistoryAccessInput,
    ctx: AuthContext,
  ): Promise<OperationalActionHistoryPage> =>
    (await read(deps, input, ctx, 'operational_history.accessed', 100)).page

export type ListOperationalActionHistory = ReturnType<typeof listOperationalActionHistory>

const exportedItem = (entry: OperationalActionHistoryPage['items'][number]) => ({
  id: entry.id as string,
  sequence: entry.sequence,
  organizationId: entry.organizationId as string,
  propertyId: entry.propertyId as string | null,
  actorType: entry.actorType,
  actorId: entry.actorId,
  actorRedactedAt: entry.actorRedactedAt?.toISOString() ?? null,
  action: entry.action,
  outcome: entry.outcome,
  resourceType: entry.resourceType,
  resourceId: entry.resourceId,
  resourceRedactedAt: entry.resourceRedactedAt?.toISOString() ?? null,
  reasonCode: entry.reasonCode,
  provenance: entry.provenance,
  occurredAt: entry.occurredAt.toISOString(),
  recordedAt: entry.recordedAt.toISOString(),
})

export const exportOperationalActionHistory =
  (deps: OperationalActionHistoryAccessDeps) =>
  async (input: OperationalActionHistoryAccessInput, ctx: AuthContext) => {
    const { page, query } = await read(
      deps,
      input,
      ctx,
      'operational_history.exported',
      500,
    )
    const body = {
      formatVersion: 1 as const,
      observedAt: query.observedAt.toISOString(),
      scope: {
        organizationId: query.organizationId as string,
        propertyId: (query.propertyId as string | undefined) ?? null,
        action: query.action ?? null,
        resourceType: query.resourceType ?? null,
        cursor: query.cursor
          ? {
              occurredAt: query.cursor.occurredAt.toISOString(),
              sequence: query.cursor.sequence,
            }
          : null,
        limit: query.limit,
      },
      items: page.items.map(exportedItem),
      nextCursor: page.nextCursor
        ? {
            occurredAt: page.nextCursor.occurredAt.toISOString(),
            sequence: page.nextCursor.sequence,
          }
        : null,
    }
    return {
      ...body,
      fingerprintSha256: sha256Hex(canonicalizeRfc8785(body)),
    }
  }

export type ExportOperationalActionHistory = ReturnType<
  typeof exportOperationalActionHistory
>
