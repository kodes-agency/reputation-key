// Retention sweep job unit tests (BQC-1.6).
// Per-rule evidence rows, failure isolation, aggregate failure semantics.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('#/shared/db/retention/execute-retention-rule', () => ({
  executeRetentionRule: vi.fn(),
}))
vi.mock('#/shared/db/retention/evidence', () => ({
  openRetentionRun: vi.fn(async (_db, subject: string) => `run-${subject}`),
  closeRetentionRun: vi.fn(async () => {}),
}))
vi.mock('#/shared/observability/logger', () => ({
  getLogger: vi.fn(() => mockLogger),
  sanitizeTelemetryValue: vi.fn((value) => value),
}))

import { executeRetentionRule } from '#/shared/db/retention/execute-retention-rule'
import { openRetentionRun, closeRetentionRun } from '#/shared/db/retention/evidence'
import {
  createRetentionSweepHandler,
  GOOGLE_IMPORT_LIFECYCLE_RETENTION_SUBJECT,
  GUEST_CONTACT_REQUEST_RETENTION_SUBJECT,
  RETENTION_RULES,
} from './retention-sweep.job'
import type { RetentionRule } from '#/shared/db/retention/execute-retention-rule'
import { RETENTION_REGISTRY } from '#/shared/db/retention/retention-registry'

const NOW = new Date('2026-07-17T12:00:00Z')

const RULE_A: RetentionRule = {
  subject: 'a.old',
  table: 'a_table',
  keyColumns: ['id'],
  tsColumn: 'created_at',
  olderThanMs: 30 * 24 * 60 * 60 * 1000,
}
const RULE_B: RetentionRule = {
  subject: 'b.old',
  table: 'b_table',
  keyColumns: ['id'],
  tsColumn: 'created_at',
  olderThanMs: 30 * 24 * 60 * 60 * 1000,
}

describe('retention sweep job (BQC-1.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('expires the Activity replay authority and projection on the same exact 90-day source clock', () => {
    const replay = RETENTION_RULES.find(
      ({ subject }) => subject === 'recent_activity_replay_facts',
    )
    const projection = RETENTION_RULES.find(
      ({ subject }) => subject === 'recent_activity_entries',
    )
    expect(replay).toMatchObject({
      table: 'recent_activity_replay_facts',
      tsColumn: 'source_occurred_at',
      olderThanMs: 90 * 24 * 60 * 60 * 1_000,
    })
    expect(projection).toMatchObject({
      table: 'recent_activity_entries',
      tsColumn: 'created_at',
      olderThanMs: replay?.olderThanMs,
    })
  })

  it('opens and closes an evidence row per rule with counts', async () => {
    ;(executeRetentionRule as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ batches: 2, rowsDeleted: 7 })
      .mockResolvedValueOnce({ batches: 1, rowsDeleted: 3 })

    const handler = createRetentionSweepHandler({
      db: {} as never,
      clock: () => NOW,
      rules: [RULE_A, RULE_B],
      batchSize: 100,
    })
    await handler({} as never)

    expect(openRetentionRun).toHaveBeenCalledTimes(2)
    expect(openRetentionRun).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'a.old',
      100,
      NOW,
    )
    expect(closeRetentionRun).toHaveBeenCalledTimes(2)
    expect(closeRetentionRun).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'run-a.old',
      expect.objectContaining({ batches: 2, rowsDeleted: 7, outcome: 'completed' }),
    )
    // Cutoff derived from the rule's olderThanMs
    const firstCall = (executeRetentionRule as ReturnType<typeof vi.fn>).mock.calls[0]
    expect((firstCall[2] as { cutoff: Date }).cutoff).toEqual(
      new Date(NOW.getTime() - RULE_A.olderThanMs),
    )
  })

  it('records pseudonym redactions separately from deletions', async () => {
    const redactRule: RetentionRule = {
      subject: 'scan_events.abuse_pseudonym',
      table: 'scan_events',
      keyColumns: ['id'],
      tsColumn: 'created_at',
      olderThanMs: 7 * 24 * 60 * 60 * 1000,
      operation: 'redact',
      redactColumns: ['ip_hash'],
      extraWhere: 'ip_hash IS NOT NULL',
    }
    ;(executeRetentionRule as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      batches: 2,
      rowsDeleted: 0,
      rowsRedacted: 7,
      capped: false,
    })

    const handler = createRetentionSweepHandler({
      db: {} as never,
      clock: () => NOW,
      rules: [redactRule],
      batchSize: 100,
    })
    await handler({} as never)

    expect(closeRetentionRun).toHaveBeenCalledWith(
      expect.anything(),
      'run-scan_events.abuse_pseudonym',
      expect.objectContaining({ rowsDeleted: 0, rowsRedacted: 7 }),
    )
  })

  it('a failing rule records failed outcome, does not block others, and the job throws after the sweep', async () => {
    ;(executeRetentionRule as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('relation a_table does not exist'))
      .mockResolvedValueOnce({ batches: 1, rowsDeleted: 5 })

    const handler = createRetentionSweepHandler({
      db: {} as never,
      clock: () => NOW,
      rules: [RULE_A, RULE_B],
      batchSize: 100,
    })

    await expect(handler({} as never)).rejects.toThrow(/1 rule\(s\) failed: a\.old/)

    // The second rule still ran
    expect(executeRetentionRule).toHaveBeenCalledTimes(2)
    expect(closeRetentionRun).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'run-a.old',
      expect.objectContaining({ outcome: 'failed' }),
    )
    expect(closeRetentionRun).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'run-b.old',
      expect.objectContaining({ outcome: 'completed', rowsDeleted: 5 }),
    )
  })

  it('logs an info line when a rule hits the per-run batch cap (BQC-3.7)', async () => {
    ;(executeRetentionRule as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      batches: 100,
      rowsDeleted: 50_000,
      capped: true,
    })

    const handler = createRetentionSweepHandler({
      db: {} as never,
      clock: () => NOW,
      rules: [RULE_A],
      batchSize: 500,
    })
    await handler({} as never)

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'a.old', capped: true }),
      expect.stringMatching(/batch cap/i),
    )
    // The run still closes as completed — the next scheduled run continues.
    expect(closeRetentionRun).toHaveBeenCalledWith(
      expect.anything(),
      'run-a.old',
      expect.objectContaining({ outcome: 'completed' }),
    )
  })

  it('records bounded Google import lifecycle evidence before ordinary rules', async () => {
    ;(executeRetentionRule as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      batches: 1,
      rowsDeleted: 2,
    })
    const googleImportLifecycleSweep = vi.fn(async () => ({
      expiredItemsVisited: 4,
      receiptsReconciled: 1,
      itemsTerminalized: 3,
      parentsPurged: 2,
      propertyReceiptsSwept: 5,
      unreleasedExpiredReceipts: 0,
    }))
    const handler = createRetentionSweepHandler({
      db: {} as never,
      clock: () => NOW,
      rules: [RULE_A],
      batchSize: 100,
      googleImportLifecycleSweep,
    })

    await handler({} as never)

    expect(openRetentionRun).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      GOOGLE_IMPORT_LIFECYCLE_RETENTION_SUBJECT,
      100,
      NOW,
    )
    expect(closeRetentionRun).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      `run-${GOOGLE_IMPORT_LIFECYCLE_RETENTION_SUBJECT}`,
      {
        finishedAt: NOW,
        batches: 1,
        rowsDeleted: 7,
        outcome: 'completed',
      },
    )
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: GOOGLE_IMPORT_LIFECYCLE_RETENTION_SUBJECT,
        expiredItemsVisited: 4,
      }),
      'Google import lifecycle retention sweep completed',
    )
  })

  it('records lifecycle failure, continues ordinary rules, then fails the job', async () => {
    ;(executeRetentionRule as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      batches: 1,
      rowsDeleted: 2,
    })
    const handler = createRetentionSweepHandler({
      db: {} as never,
      clock: () => NOW,
      rules: [RULE_A],
      googleImportLifecycleSweep: vi.fn(async () => {
        throw new Error('receipt release backlog')
      }),
    })

    await expect(handler({} as never)).rejects.toThrow(
      GOOGLE_IMPORT_LIFECYCLE_RETENTION_SUBJECT,
    )

    expect(executeRetentionRule).toHaveBeenCalledTimes(1)
    expect(closeRetentionRun).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      `run-${GOOGLE_IMPORT_LIFECYCLE_RETENTION_SUBJECT}`,
      expect.objectContaining({
        outcome: 'failed',
        errorCode: 'receipt release backlog',
      }),
    )
  })

  it('records the Guest-owned Contact Request material purge as bounded redaction evidence', async () => {
    ;(executeRetentionRule as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      batches: 1,
      rowsDeleted: 2,
    })
    const guestContactRequestRetentionSweep = vi.fn(async () => ({
      batches: 2,
      processed: 7,
      capped: false,
      completedThrough: NOW,
    }))
    const handler = createRetentionSweepHandler({
      db: {} as never,
      clock: () => NOW,
      rules: [RULE_A],
      batchSize: 100,
      guestContactRequestRetentionSweep,
    })

    await handler({} as never)

    expect(guestContactRequestRetentionSweep).toHaveBeenCalledWith({ batchSize: 100 })
    expect(openRetentionRun).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      GUEST_CONTACT_REQUEST_RETENTION_SUBJECT,
      100,
      NOW,
    )
    expect(closeRetentionRun).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      `run-${GUEST_CONTACT_REQUEST_RETENTION_SUBJECT}`,
      {
        finishedAt: NOW,
        batches: 2,
        rowsDeleted: 0,
        rowsRedacted: 7,
        outcome: 'completed',
      },
    )
  })

  it('keeps ordinary retention running and fails the job when Contact Request purge fails', async () => {
    ;(executeRetentionRule as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      batches: 1,
      rowsDeleted: 2,
    })
    const handler = createRetentionSweepHandler({
      db: {} as never,
      clock: () => NOW,
      rules: [RULE_A],
      guestContactRequestRetentionSweep: vi.fn(async () => {
        throw new Error('contact purge unavailable')
      }),
    })

    await expect(handler({} as never)).rejects.toThrow(
      GUEST_CONTACT_REQUEST_RETENTION_SUBJECT,
    )
    expect(executeRetentionRule).toHaveBeenCalledTimes(1)
    expect(closeRetentionRun).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      `run-${GUEST_CONTACT_REQUEST_RETENTION_SUBJECT}`,
      expect.objectContaining({
        outcome: 'failed',
        errorCode: 'contact purge unavailable',
      }),
    )
  })
})

describe('retention rule registry (BQC-3.7)', () => {
  it('deletes separated private-feedback text at its exact deadline', () => {
    expect(
      RETENTION_RULES.find(
        (rule) => rule.subject === 'guest_response_private_feedback.expired',
      ),
    ).toMatchObject({
      table: 'guest_response_private_feedback',
      keyColumns: ['response_id'],
      tsColumn: 'expires_at',
      olderThanMs: 0,
    })
  })

  it('deletes recovery authority and content-free facts on independent deadlines', () => {
    expect(
      RETENTION_RULES.find(
        (rule) => rule.subject === 'guest_response_session_bindings.expired',
      ),
    ).toMatchObject({
      table: 'guest_response_session_bindings',
      keyColumns: ['response_id'],
      tsColumn: 'expires_at',
      olderThanMs: 0,
    })
    expect(
      RETENTION_RULES.find(
        (rule) => rule.subject === 'guest_responses.deidentified_fact',
      ),
    ).toMatchObject({
      table: 'guest_responses',
      keyColumns: ['id'],
      tsColumn: 'retention_deadline',
      olderThanMs: 0,
    })
  })

  it('deletes destination-action session receipts at their exact expiry', () => {
    expect(
      RETENTION_RULES.find(
        (rule) => rule.subject === 'guest_destination_action_receipts.expired',
      ),
    ).toMatchObject({
      table: 'guest_destination_action_receipts',
      keyColumns: ['id'],
      tsColumn: 'expires_at',
      olderThanMs: 0,
    })
  })

  it('deletes Qualified Scan session receipts at their exact expiry', () => {
    expect(
      RETENTION_RULES.find(
        (rule) => rule.subject === 'guest_qualified_scan_receipts.expired',
      ),
    ).toMatchObject({
      table: 'guest_qualified_scan_receipts',
      keyColumns: ['id'],
      tsColumn: 'expires_at',
      olderThanMs: 0,
    })
  })

  it('deletes the canonical network-pressure class at its fixed seven-day expiry', () => {
    expect(
      RETENTION_RULES.find(
        (rule) => rule.subject === 'guest_network_pressure_records.expired',
      ),
    ).toEqual({
      subject: 'guest_network_pressure_records.expired',
      table: 'guest_network_pressure_records',
      keyColumns: ['id'],
      tsColumn: 'expires_at',
      olderThanMs: 0,
    })
  })

  it('redacts every legacy guest abuse pseudonym after seven days', () => {
    for (const table of ['scan_events', 'ratings', 'feedback']) {
      expect(
        RETENTION_RULES.find((rule) => rule.subject === `${table}.abuse_pseudonym`),
      ).toMatchObject({
        table,
        tsColumn: 'created_at',
        olderThanMs: 7 * 24 * 60 * 60 * 1000,
        operation: 'redact',
        redactColumns: ['ip_hash'],
        extraWhere: 'ip_hash IS NOT NULL',
      })
    }
  })

  it('redacts every legacy guest session pseudonym after 24 hours', () => {
    for (const table of ['scan_events', 'ratings', 'feedback']) {
      expect(
        RETENTION_RULES.find(
          (rule) => rule.subject === `${table}.guest_session_pseudonym`,
        ),
      ).toMatchObject({
        table,
        tsColumn: 'created_at',
        olderThanMs: 24 * 60 * 60 * 1000,
        operation: 'redact',
        redactColumns: ['session_id'],
        extraWhere: 'session_id IS NOT NULL',
      })
    }
  })

  it('keys outbox retention on published_at, not created_at', () => {
    const outboxRule = RETENTION_RULES.find(
      (r) => r.subject === 'outbox_events.published',
    )
    expect(outboxRule).toBeDefined()
    // An event unpublished 29d then published must survive ~30 more days —
    // keying on created_at would delete it ~1d after publication.
    expect(outboxRule!.tsColumn).toBe('published_at')
    expect(outboxRule!.extraWhere).toBe('published_at IS NOT NULL')
    // BQC-1.6's deliberate 30d value (the migration-file comment drift —
    // 7d/90d — is documented at the rule; applied migrations are immutable).
    expect(outboxRule!.olderThanMs).toBe(30 * 24 * 60 * 60 * 1000)
  })

  it('touches a compatibility mirror only through row-preserving redaction', () => {
    const mirrors = new Set(['scan_events', 'ratings', 'feedback'])
    const mirrorRules = RETENTION_RULES.filter((rule) => mirrors.has(rule.table))
    expect(mirrorRules).toHaveLength(6)
    for (const rule of mirrorRules) {
      expect(rule.operation, rule.subject).toBe('redact')
    }
  })

  it('removes expired durable Google discovery state at its exact deadline', () => {
    expect(
      RETENTION_RULES.find(
        (rule) => rule.subject === 'google_import_discovery_records.expired',
      ),
    ).toMatchObject({
      table: 'google_import_discovery_records',
      keyColumns: ['reference_key'],
      tsColumn: 'expires_at',
      olderThanMs: 0,
    })
    expect(
      RETENTION_RULES.find(
        (rule) => rule.subject === 'google_import_discovery_invalidations.expired',
      ),
    ).toMatchObject({
      table: 'google_import_discovery_invalidations',
      keyColumns: ['invalidation_key'],
      tsColumn: 'expires_at',
      olderThanMs: 0,
    })
  })

  it('retains open digest batches and purges only terminal evidence after 90 days', () => {
    expect(
      RETENTION_RULES.find((rule) => rule.subject === 'notification_digest_batches'),
    ).toMatchObject({
      table: 'notification_digest_batches',
      keyColumns: ['id'],
      tsColumn: 'updated_at',
      olderThanMs: 90 * 24 * 60 * 60 * 1000,
      extraWhere: "state IN ('accepted', 'terminal')",
    })
  })

  it('uses the queue state machine terminal names for email retention', () => {
    expect(
      RETENTION_RULES.find((rule) => rule.subject === 'notification_email_queue'),
    ).toMatchObject({
      extraWhere:
        "status IN ('accepted', 'delivered', 'bounced', 'complained', 'failed', 'suppressed')",
    })
  })

  it('covers the action-audit table at the 365d beta audit horizon (BQC-7.8)', () => {
    const logs = RETENTION_RULES.find((rule) => rule.subject === 'audit_logs')
    expect(logs).toMatchObject({
      table: 'audit_logs',
      keyColumns: ['id'],
      tsColumn: 'created_at',
      olderThanMs: 365 * 24 * 60 * 60 * 1000,
    })
  })

  it('deliberately has NO rule for retention_runs — the evidence chain is indefinite (BQC-7.8)', () => {
    // retention_runs rows are the content-free evidence FOR deletions —
    // deleting them would erase the proof of erasure. Indefinite-by-design;
    // documented in docs/operations/backup-and-lifecycle.md.
    expect(RETENTION_RULES.some((r) => r.table === 'retention_runs')).toBe(false)
  })

  it('refuses a pending-counsel registry rule before opening any evidence row (LIF-01-T16)', async () => {
    vi.clearAllMocks()
    const handler = createRetentionSweepHandler({
      db: {} as never,
      clock: () => NOW,
      rules: [RULE_A],
      registryApplyRules: RETENTION_REGISTRY,
    })

    await expect(handler({} as never)).rejects.toThrow(/pending_counsel/)
    // The refusal happens first: no evidence row exists and nothing executed,
    // so a refused sweep cannot leave a half-finished run behind.
    expect(openRetentionRun).not.toHaveBeenCalled()
    expect(closeRetentionRun).not.toHaveBeenCalled()
    expect(executeRetentionRule).not.toHaveBeenCalled()
  })

  it('runs the separately authorized sweep rules when no registry rule is handed in', async () => {
    vi.clearAllMocks()
    vi.mocked(executeRetentionRule).mockResolvedValue({
      batches: 1,
      rowsDeleted: 1,
      rowsRedacted: 0,
      capped: false,
    })
    const handler = createRetentionSweepHandler({
      db: {} as never,
      clock: () => NOW,
      rules: [RULE_A],
    })

    await handler({} as never)

    expect(executeRetentionRule).toHaveBeenCalledTimes(1)
  })
})
