import type { Database } from '#/shared/db'
import type { DomainEvent } from '#/shared/events/events'
import { insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import type { Permission } from '#/shared/domain/permissions'
import type { InboxItem } from '#/contexts/inbox/domain/types'
import { inboxError } from '#/contexts/inbox/domain/errors'
import { inTransaction } from '#/contexts/inbox/infrastructure/inbox-command-transaction'
import {
  sourceCommandPermission,
  webActorId,
} from '#/contexts/inbox/infrastructure/inbox-command-guards'
import type {
  InboxCommandAuthority,
  InboxCommandAuthorityPrincipal,
  InboxCommandAuthorityRequirement,
} from '#/contexts/inbox/infrastructure/inbox-command-authority'
import { updateItemRow } from '#/contexts/inbox/infrastructure/inbox-source-projection'

export type CommandRuntime = Readonly<{
  db: Database
  authorizeCommand: InboxCommandAuthority
  clock: () => Date
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
    event: DomainEvent | null,
    at: Date,
    appendHistory?: (tx: Tx, row: InboxItem) => Promise<void>,
    lent?: Tx,
  ) => Promise<InboxItem>
}>

export const createCommandRuntime = (
  db: Database,
  authorizeCommand: InboxCommandAuthority,
  clock: () => Date,
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
   * Shared runner: single-row update + optional fact, one transaction.
   *
   * `appendHistory` runs between the compare-and-swap and the outbox insert so
   * an append-only history row, the projection update and the fact either all
   * commit or none do.
   */
  const transition = async (
    span: string,
    item: InboxItem,
    set: Record<string, unknown>,
    notFoundMessage: string,
    event: DomainEvent | null,
    at: Date,
    appendHistory?: (tx: Tx, row: InboxItem) => Promise<void>,
    lent?: Tx,
  ): Promise<InboxItem> => {
    return trace(span, async () => {
      return inTransaction(db, lent, async (tx) => {
        await assertCommandAuthority(
          tx,
          item.organizationId,
          event?.occurredAt ?? at,
          authorityRequirements(item, actorPrincipals(item, event)),
        )
        const row = await updateItemRow(tx, item, set, notFoundMessage)
        if (appendHistory) await appendHistory(tx, row)
        if (event) await insertOutboxRow(tx, event)
        return row
      })
    })
  }

  return {
    db,
    authorizeCommand,
    clock,
    assertCommandAuthority,
    authorityRequirements,
    actorPrincipals,
    transition,
  }
}
