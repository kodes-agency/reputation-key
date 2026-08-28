// Inbox context — bounded all-or-nothing assignment command.
//
// The application boundary performs privacy-safe availability/revision
// preflight. The command store then locks and reauthorizes the complete set;
// either every eligible transition and fact commits or none does.

import type { InboxRepository, InboxSourceScope } from '../ports/inbox.repository'
import type { InboxCommandStore } from '../ports/inbox-command-store.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { InboxItemId, PropertyId, UserId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { canForContext } from '#/shared/domain/permissions'
import { getAccessiblePropertyIdsForPermission } from '#/shared/domain/property-access'
import {
  canHandleInboxSource,
  isInboxSourcePropertyWithinScopes,
  resolveInboxSourceScopes,
} from '../inbox-access'
import { inboxError } from '../../domain/errors'
import { INBOX_BULK_LIMIT } from '../dto/inbox.dto'

export type BulkAssignInboxItemInput = Readonly<{
  inboxItemId: InboxItemId
  expectedCommandRevision: number
}>

export type BulkAssignInboxItemsInput = Readonly<{
  items: ReadonlyArray<BulkAssignInboxItemInput>
  assignedToUserId: UserId | null
}>

export type BulkAssignmentOutcome =
  | 'assigned'
  | 'reassigned'
  | 'released'
  | 'unchanged'
  | 'revision_conflict'
  | 'unavailable'
  | 'batch_aborted'

export type BulkAssignmentItemResult = Readonly<{
  inboxItemId: InboxItemId
  outcome: BulkAssignmentOutcome
}>

export type BulkAssignInboxItemsResult = Readonly<{
  updated: number
  bulkId: string | null
  results: ReadonlyArray<BulkAssignmentItemResult>
}>

export type BulkAssignInboxItemsDeps = Readonly<{
  repo: InboxRepository
  commandStore: InboxCommandStore
  staffPublicApi: StaffPublicApi
  clock: () => Date
  idGen: () => string
}>

type AccessEnvelope = Readonly<{
  sourceScopes: ReadonlyArray<InboxSourceScope>
  managePropertyIds: ReadonlyArray<PropertyId> | null
}>

const resolveAccess = async (
  deps: BulkAssignInboxItemsDeps,
  ctx: AuthContext,
): Promise<AccessEnvelope | null> => {
  try {
    const lookup = (
      organizationId: AuthContext['organizationId'],
      actorId: AuthContext['userId'],
      orgWide: boolean,
    ) => deps.staffPublicApi.getAccessiblePropertyIds(organizationId, actorId, orgWide)
    const [sourceScopes, managePropertyIds] = await Promise.all([
      resolveInboxSourceScopes(deps.staffPublicApi, ctx, 'handle'),
      getAccessiblePropertyIdsForPermission(lookup, ctx, 'inbox.manage'),
    ])
    return { sourceScopes, managePropertyIds }
  } catch {
    return null
  }
}

const isManagedProperty = (
  propertyIds: ReadonlyArray<PropertyId> | null,
  propertyId: PropertyId,
): boolean => propertyIds === null || propertyIds.includes(propertyId)

export const bulkAssignInboxItems =
  (deps: BulkAssignInboxItemsDeps) =>
  async (
    input: BulkAssignInboxItemsInput,
    ctx: AuthContext,
  ): Promise<BulkAssignInboxItemsResult> => {
    if (!canForContext(ctx, 'inbox.write') || !canForContext(ctx, 'inbox.manage')) {
      throw inboxError('forbidden', 'No permission to manage Inbox assignments')
    }
    if (
      input.items.length === 0 ||
      input.items.length > INBOX_BULK_LIMIT ||
      new Set(input.items.map((item) => item.inboxItemId)).size !== input.items.length
    ) {
      throw inboxError('invalid_input', 'Inbox bulk assignment selection is invalid')
    }

    const access = await resolveAccess(deps, ctx)
    if (!access) {
      return {
        updated: 0,
        bulkId: null,
        results: input.items.map((item) => ({
          inboxItemId: item.inboxItemId,
          outcome: 'unavailable',
        })),
      }
    }

    const loaded = await deps.repo.findByIds(
      input.items.map((item) => item.inboxItemId),
      ctx.organizationId,
    )
    const byId = new Map(loaded.map((item) => [item.id, item]))
    const preflight = input.items.map((command): BulkAssignmentItemResult | null => {
      const item = byId.get(command.inboxItemId)
      if (
        !item ||
        !canHandleInboxSource(ctx, item.sourceType) ||
        !isInboxSourcePropertyWithinScopes(
          access.sourceScopes,
          item.sourceType,
          item.propertyId,
        ) ||
        !isManagedProperty(access.managePropertyIds, item.propertyId)
      ) {
        return { inboxItemId: command.inboxItemId, outcome: 'unavailable' }
      }
      if (item.commandRevision !== command.expectedCommandRevision) {
        return { inboxItemId: command.inboxItemId, outcome: 'revision_conflict' }
      }
      return null
    })
    if (preflight.some((result) => result !== null)) {
      return {
        updated: 0,
        bulkId: null,
        results: preflight.map(
          (result, index): BulkAssignmentItemResult =>
            result ?? {
              inboxItemId: input.items[index]!.inboxItemId,
              outcome: 'batch_aborted',
            },
        ),
      }
    }

    const bulkId = deps.idGen()
    const stored = await deps.commandStore.bulkAssign({
      items: input.items.map((command) => byId.get(command.inboxItemId)!),
      assignedTo: input.assignedToUserId,
      actorId: ctx.userId,
      bulkId,
      occurredAt: deps.clock(),
    })
    return { ...stored, bulkId }
  }

export type BulkAssignInboxItems = ReturnType<typeof bulkAssignInboxItems>
