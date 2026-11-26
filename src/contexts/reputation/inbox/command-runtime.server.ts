import type { Database } from '#/shared/db'
import type { DomainEvent } from '#/shared/events/events'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import type { Permission } from '#/shared/domain/permissions'
import type { InboxItem } from '#/contexts/reputation/domain/inbox-types'
import { inboxError } from '#/contexts/reputation/domain/inbox-errors'
import { inTransaction } from '#/contexts/reputation/inbox/inbox-command-transaction.server'
import {
  itemFromRow,
  sourceCommandPermission,
  validCycleNumber,
  webActorId,
} from '#/contexts/reputation/inbox/inbox-command-guards.server'
import type {
  InboxCommandAuthority,
  InboxCommandAuthorityPrincipal,
  InboxCommandAuthorityRequirement,
} from '#/contexts/reputation/inbox/inbox-command-authority.server'
import { updatePersistedItemRow } from '#/contexts/reputation/inbox/inbox-source-projection.server'

export type CommandRuntime = Readonly<{
  db: Database
  authorizeCommand: InboxCommandAuthority
  assertCommandAuthority: (
    tx: Tx,
    organizationId: string,
    at: Date,
    requirements: readonly InboxCommandAuthorityRequirement[],
  ) => Promise<void>
  authorityRequirements: (
    item: InboxItem,
    principals: readonly InboxCommandAuthorityPrincipal[],
  ) => InboxCommandAuthorityRequirement[]
  actorPrincipals: (
    item: InboxItem,
    event: DomainEvent | null,
    extraPermissions?: readonly Permission[],
  ) => InboxCommandAuthorityPrincipal[]
  transition: (
    span: string,
    item: InboxItem,
    set: Record<string, unknown>,
    notFoundMessage: string,
    event: DomainEvent,
    appendHistory?: (
      tx: Tx,
      row: InboxItem,
      handlingCycleNumber: number | null,
    ) => Promise<void>,
    lent?: Tx,
  ) => Promise<InboxItem>
}>

export const createCommandRuntime = (
  db: Database,
  authorizeCommand: InboxCommandAuthority,
): CommandRuntime => {
  const assertCommandAuthority = async (
    tx: Tx,
    organizationId: string,
    at: Date,
    requirements: readonly InboxCommandAuthorityRequirement[],
  ): Promise<void> => {
    if (requirements.length === 0) return
    const decision = await authorizeCommand(tx, {
      organizationId,
      at,
      requirements,
    })
    if (!decision.allowed) {
      throw inboxError('forbidden', 'Inbox command authority is no longer current', {
        authorityReason: decision.reason,
      })
    }
  }

  const authorityRequirements = (
    item: InboxItem,
    principals: readonly InboxCommandAuthorityPrincipal[],
  ): InboxCommandAuthorityRequirement[] =>
    principals.map((principal) => ({ ...principal, propertyId: item.propertyId }))

  const actorPrincipals = (
    item: InboxItem,
    event: DomainEvent | null,
    extraPermissions: readonly Permission[] = [],
  ): InboxCommandAuthorityPrincipal[] => {
    const actorId = webActorId(event)
    return actorId === null
      ? []
      : [
          {
            userId: actorId,
            permissions: [
              'inbox.write',
              sourceCommandPermission(item.sourceType),
              ...extraPermissions,
            ],
            purpose: 'actor',
          },
        ]
  }

  /**
   * Shared runner: single-row update + fact, one transaction.
   *
   * `appendHistory` runs between the compare-and-swap and the outbox insert so
   * an append-only history row, the projection update and the fact either all
   * commit or none do. It receives the cycle number the compare-and-swap row
   * carries, which is the cycle the decision landed in.
   */
  const transition = async (
    span: string,
    item: InboxItem,
    set: Record<string, unknown>,
    notFoundMessage: string,
    event: DomainEvent,
    appendHistory?: (
      tx: Tx,
      row: InboxItem,
      handlingCycleNumber: number | null,
    ) => Promise<void>,
    lent?: Tx,
  ): Promise<InboxItem> => {
    return trace(span, async () => {
      return inTransaction(db, lent, async (tx) => {
        await assertCommandAuthority(
          tx,
          item.organizationId,
          event.occurredAt,
          authorityRequirements(item, actorPrincipals(item, event)),
        )
        const persisted = await updatePersistedItemRow(tx, item, set, notFoundMessage)
        const row = itemFromRow(persisted)
        if (appendHistory) {
          await appendHistory(tx, row, validCycleNumber(persisted.currentCycleNumber))
        }
        await insertOutboxRow(tx, event)
        return row
      })
    })
  }

  return {
    db,
    authorizeCommand,
    assertCommandAuthority,
    authorityRequirements,
    actorPrincipals,
    transition,
  }
}
