import { randomUUID } from 'node:crypto'
import { and, asc, eq, gt, inArray, lte, sql } from 'drizzle-orm'
import type { Database, Tx } from './index'
import type { Clock } from '#/shared/domain/clock'
import {
  workItems,
  type WorkItem,
  type WorkRecovery,
  type WorkState,
} from './schema/work-items.schema'

export type WorkRequest = Readonly<{
  organizationId: string
  subjectId: string
  kind: string
  idempotencyKey: string
  dueAt: Date
  recovery: WorkRecovery
  maxAttempts?: number
}>

export function createWorkItems(db: Database, clock: Clock) {
  const inspect = async (
    organizationId: string,
    id: string,
  ): Promise<WorkItem | undefined> =>
    (
      await db
        .select()
        .from(workItems)
        .where(and(eq(workItems.organizationId, organizationId), eq(workItems.id, id)))
        .limit(1)
    )[0]

  return {
    inspect,
    // Worker dispatch starts from an opaque queue ID, before entering tenant scope.
    async resolveDispatch(
      id: string,
    ): Promise<Pick<WorkItem, 'organizationId' | 'subjectId' | 'kind'> | undefined> {
      const [row] = await db
        .select({
          organizationId: workItems.organizationId,
          subjectId: workItems.subjectId,
          kind: workItems.kind,
        })
        .from(workItems)
        .where(eq(workItems.id, id))
        .limit(1)
      return row
    },
    async list(organizationId: string) {
      return db
        .select()
        .from(workItems)
        .where(eq(workItems.organizationId, organizationId))
        .orderBy(
          sql`CASE WHEN ${workItems.state} IN ('uncertain', 'quarantined') THEN 0 WHEN ${workItems.state} IN ('pending', 'running') THEN 1 ELSE 2 END`,
          asc(workItems.createdAt),
          asc(workItems.id),
        )
        .limit(100)
    },
    // Pass the source command's transaction so its intent and work commit together.
    async schedule(input: WorkRequest, transaction: Database | Tx = db) {
      const now = clock()
      const [inserted] = await transaction
        .insert(workItems)
        .values({
          ...input,
          dispatchAfter: input.dueAt,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: [workItems.organizationId, workItems.kind, workItems.idempotencyKey],
        })
        .returning()
      if (inserted) return inserted
      const [existing] = await transaction
        .select()
        .from(workItems)
        .where(
          and(
            eq(workItems.organizationId, input.organizationId),
            eq(workItems.kind, input.kind),
            eq(workItems.idempotencyKey, input.idempotencyKey),
          ),
        )
      if (
        !existing ||
        existing.subjectId !== input.subjectId ||
        existing.recovery !== input.recovery
      ) {
        throw new Error('Work idempotency key binding mismatch')
      }
      return existing
    },
    async claim(
      organizationId: string,
      id: string,
      leaseMs: number,
    ): Promise<WorkItem | undefined> {
      if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 3_600_000)
        throw new Error('Invalid work lease')
      const now = clock()
      const [claimed] = await db
        .update(workItems)
        .set({
          state: 'running',
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(now.getTime() + leaseMs),
          attempts: sql`${workItems.attempts} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(workItems.organizationId, organizationId),
            eq(workItems.id, id),
            eq(workItems.state, 'pending'),
            lte(workItems.dueAt, now),
            sql`${workItems.attempts} < ${workItems.maxAttempts}`,
          ),
        )
        .returning()
      return claimed
    },
    // Database effects and success share a transaction. The callback must make
    // no external calls; providers use their own attempt fence and read-back.
    async complete(
      organizationId: string,
      id: string,
      leaseToken: string,
      effect: (tx: Tx) => Promise<void>,
    ) {
      return db.transaction(async (tx) => {
        const now = clock()
        const [owned] = await tx
          .select()
          .from(workItems)
          .where(
            and(
              eq(workItems.organizationId, organizationId),
              eq(workItems.id, id),
              eq(workItems.state, 'running'),
              eq(workItems.leaseToken, leaseToken),
              gt(workItems.leaseExpiresAt, now),
            ),
          )
          .for('update')
        if (!owned) return false
        await effect(tx)
        await tx
          .update(workItems)
          .set({
            state: 'succeeded',
            leaseToken: null,
            leaseExpiresAt: null,
            completedAt: now,
            updatedAt: now,
            errorCode: null,
          })
          .where(and(eq(workItems.organizationId, organizationId), eq(workItems.id, id)))
        return true
      })
    },
    async fail(organizationId: string, id: string, leaseToken: string) {
      const now = clock()
      return db
        .update(workItems)
        .set({
          state: sql`CASE WHEN ${workItems.recovery} = 'read_back' THEN 'uncertain' WHEN ${workItems.attempts} >= ${workItems.maxAttempts} THEN 'quarantined' ELSE 'pending' END`,
          errorCode: sql`CASE WHEN ${workItems.recovery} = 'read_back' THEN 'uncertain_write' WHEN ${workItems.attempts} >= ${workItems.maxAttempts} THEN 'attempts_exhausted' ELSE 'handler_failed' END`,
          leaseToken: null,
          leaseExpiresAt: null,
          dueAt: new Date(now.getTime() + 60_000),
          dispatchAfter: new Date(now.getTime() + 60_000),
          updatedAt: now,
        })
        .where(
          and(
            eq(workItems.organizationId, organizationId),
            eq(workItems.id, id),
            eq(workItems.state, 'running'),
            eq(workItems.leaseToken, leaseToken),
            gt(workItems.leaseExpiresAt, now),
          ),
        )
        .returning()
    },
    async resolveUncertain(
      organizationId: string,
      id: string,
      readBack: (subjectId: string) => Promise<'applied' | 'not_applied' | 'unknown'>,
    ) {
      const row = await inspect(organizationId, id)
      if (!row || row.state !== 'uncertain') return false
      // Provider I/O stays outside the transaction. A concurrent operator
      // settlement wins over this observation and cannot be overwritten.
      const observation = await readBack(row.subjectId)
      if (observation === 'unknown') return false
      const now = clock()
      const [changed] = await db
        .update(workItems)
        .set({
          state:
            observation === 'applied'
              ? 'succeeded'
              : row.attempts >= row.maxAttempts
                ? 'quarantined'
                : 'pending',
          completedAt: observation === 'applied' ? now : null,
          errorCode:
            observation === 'applied'
              ? null
              : row.attempts >= row.maxAttempts
                ? 'attempts_exhausted'
                : null,
          dueAt: now,
          dispatchAfter: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(workItems.organizationId, organizationId),
            eq(workItems.id, id),
            eq(workItems.state, 'uncertain'),
            eq(workItems.attempts, row.attempts),
            eq(workItems.updatedAt, row.updatedAt),
          ),
        )
        .returning()
      return changed !== undefined
    },
    async reserveDispatch() {
      const now = clock()
      return db.transaction(async (tx) => {
        // No LIMIT before SKIP LOCKED: locked/poison rows must not fill a
        // candidate page and hide healthy tenants outside it.
        await tx.execute(sql`
          WITH ranked AS (
            SELECT id, row_number() OVER (PARTITION BY organization_id ORDER BY lease_expires_at, id) AS turn
            FROM work_items WHERE state = 'running' AND lease_expires_at <= ${now}
          ), expired AS (
            SELECT w.id FROM work_items w JOIN ranked r ON w.id = r.id
            WHERE w.state = 'running' AND w.lease_expires_at <= ${now}
            ORDER BY r.turn, w.lease_expires_at, w.id FOR UPDATE OF w SKIP LOCKED LIMIT 100
          )
          UPDATE work_items w SET
            state = CASE WHEN recovery = 'read_back' THEN 'uncertain' WHEN attempts >= max_attempts THEN 'quarantined' ELSE 'pending' END,
            error_code = CASE WHEN recovery = 'read_back' THEN 'uncertain_write' WHEN attempts >= max_attempts THEN 'attempts_exhausted' ELSE 'lease_expired' END,
            lease_token = NULL, lease_expires_at = NULL, updated_at = ${now}, dispatch_after = ${now}
          FROM expired e WHERE w.id = e.id`)
        const dispatched = await tx.execute<{
          id: string
          kind: string
          dispatchSequence: number
        }>(sql`
          WITH ranked AS (
            SELECT id, row_number() OVER (PARTITION BY organization_id ORDER BY dispatch_after, id) AS turn
            FROM work_items WHERE state = 'pending' AND due_at <= ${now} AND dispatch_after <= ${now}
          ), picked AS (
            SELECT w.id FROM work_items w JOIN ranked r ON w.id = r.id
            WHERE w.state = 'pending' AND w.due_at <= ${now} AND w.dispatch_after <= ${now}
            ORDER BY r.turn, w.dispatch_after, w.id FOR UPDATE OF w SKIP LOCKED LIMIT 100
          )
          UPDATE work_items w SET dispatch_after = ${new Date(now.getTime() + 60_000)},
            dispatch_sequence = dispatch_sequence + 1, updated_at = ${now}
          FROM picked p WHERE w.id = p.id
          RETURNING w.id, w.kind, w.dispatch_sequence AS "dispatchSequence"`)
        return dispatched.rows
      })
    },
    async operate(
      organizationId: string,
      id: string,
      action: 'retry' | 'cancel' | 'discard',
      operatorId: string,
      reason: string,
    ): Promise<WorkItem | undefined> {
      if (!operatorId.trim() || !reason.trim() || reason.length > 500)
        throw new Error('Operator and bounded reason required')
      const now = clock()
      // An uncertain effect needs owner read-back, never an operator retry.
      // Active leases cannot be cancelled underneath a still-running handler.
      const allowed: WorkState[] =
        action === 'retry'
          ? ['quarantined']
          : action === 'cancel'
            ? ['pending', 'quarantined']
            : ['pending', 'quarantined', 'uncertain', 'cancelled']
      const [changed] = await db
        .update(workItems)
        .set({
          state:
            action === 'retry'
              ? 'pending'
              : action === 'cancel'
                ? 'cancelled'
                : 'discarded',
          ...(action === 'retry'
            ? {
                maxAttempts: sql`least(${workItems.maxAttempts} + 8, 100)`,
                dueAt: now,
                dispatchAfter: now,
                errorCode: null,
              }
            : {}),
          completedAt: action === 'retry' ? null : now,
          updatedAt: now,
          operatorId,
          operatorReason: reason,
        })
        .where(
          and(
            eq(workItems.organizationId, organizationId),
            eq(workItems.id, id),
            inArray(workItems.state, allowed),
            action === 'retry' ? sql`${workItems.attempts} < 100` : undefined,
          ),
        )
        .returning()
      return changed
    },
  }
}

export type WorkItems = ReturnType<typeof createWorkItems>
