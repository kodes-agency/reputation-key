import { NOTIFICATION_RIGHTS_TABLES } from '../domain/notification-rights-tables'
import { describe, expect, it } from 'vitest'
import {
  parseOperatorArgs,
  type OperatorContext,
  type OperatorIO,
} from '#/shared/ops/operator-command'
import { createNotificationRightsExecutor } from '#/shared/ops/rights/notification-rights-executor'
import {
  handleRightsRequest,
  type RightsRequestEffects,
} from '#/shared/ops/rights/run-rights-request'
import { rightsRequestCommandSpec } from '#/shared/ops/rights/rights-request-command'
import type { RightsAuditEvent } from '#/shared/ops/rights/rights-audit'
import { createRightsJournal } from '#/shared/ops/rights/rights-journal'
import {
  buildManualFinalWarning,
  runNotificationRights,
  type ManualFinalWarning,
  type NotificationRightsPort,
} from './executor.server'
import type { RightsRow, ScopedRightsRow } from './fields'

const ORG_A = 'org-a'
const ORG_B = 'org-b'
const PROPERTY_A1 = '5eed0100-0000-4000-8000-0000000000a1'
const PROPERTY_A2 = '5eed0100-0000-4000-8000-0000000000a2'
const PROPERTY_B1 = '5eed0100-0000-4000-8000-0000000000b1'
const VERIFIED = ['verified=2026-11-01T10:00:00Z', 'verification=ticket:123']

const row = (
  organizationId: string,
  propertyId: string | null,
  fields: RightsRow,
): ScopedRightsRow => ({ organizationId, propertyId, fields })

type Store = {
  history: ScopedRightsRow[]
  preferences: ScopedRightsRow[]
  userSettings: ScopedRightsRow[]
  removals: ScopedRightsRow[]
  admins: Record<string, string[]>
}

function seed(): Store {
  return {
    history: [
      row(ORG_A, PROPERTY_A1, { id: 'n-a1', title: 'A1 review', body: 'hello' }),
      row(ORG_A, PROPERTY_A2, { id: 'n-a2', title: 'A2 review', body: null }),
      row(ORG_B, PROPERTY_B1, { id: 'n-b1', title: 'B secret', body: 'b body' }),
    ],
    preferences: [
      row(ORG_A, PROPERTY_A1, { id: 'p-a1', category: 'mandatory', enabled: true }),
      row(ORG_B, PROPERTY_B1, { id: 'p-b1', category: 'mandatory', enabled: false }),
    ],
    userSettings: [
      row(ORG_A, null, { id: 's-a', locale: 'en', timezone: 'UTC' }),
      row(ORG_B, null, { id: 's-b', locale: 'bg', timezone: 'Europe/Sofia' }),
    ],
    removals: [
      row(ORG_A, null, { userId: 'former-a', eventId: 'removal-a', createdAt: 't' }),
      row(ORG_A, null, { userId: 'admin-a', eventId: 'removal-x', createdAt: 't' }),
      row(ORG_B, null, { userId: 'former-b', eventId: 'removal-b', createdAt: 't' }),
    ],
    admins: { [ORG_A]: ['admin-a'], [ORG_B]: ['admin-b'] },
  }
}

function fakePort(store: Store, sent: ManualFinalWarning[], deleted: string[]) {
  const inScope = (rows: ScopedRightsRow[], org: string, property?: string) =>
    rows.filter(
      (r) => r.organizationId === org && (!property || r.propertyId === property),
    )
  const port: NotificationRightsPort = {
    history: async (s) => inScope(store.history, s.organizationId, s.propertyId),
    preferences: async (s) => inScope(store.preferences, s.organizationId, s.propertyId),
    userSettings: async (s) =>
      s.propertyId ? [] : inScope(store.userSettings, s.organizationId),
    formerMembers: async (org) => inScope(store.removals, org),
    accountAdmins: async (org) => store.admins[org] ?? [],
    organizationPayload: async (org) => ({ organizationName: `Name of ${org}` }),
    rowCounts: async (s) => ({
      notifications: inScope(store.history, s.organizationId, s.propertyId).length,
    }),
    purge: async (s) => {
      deleted.push(`${s.organizationId}/${s.propertyId ?? '*'}`)
      return { notifications: 1 }
    },
    send: async (warning) => {
      sent.push(warning)
    },
  }
  return port
}

async function runScript(
  store: Store,
  org: string,
  argv: string[],
  {
    tamper,
    auditFails,
  }: {
    tamper?: boolean
    auditFails?: boolean
  } = {},
) {
  const sent: ManualFinalWarning[] = []
  const deleted: string[] = []
  const exports: string[] = []
  const out: string[] = []
  const err: string[] = []
  const journalWrites: string[] = []
  const audits: RightsAuditEvent[] = []
  const basePort = fakePort(store, sent, deleted)
  const port: NotificationRightsPort = tamper
    ? { ...basePort, history: async () => store.history }
    : basePort
  const parsed = parseOperatorArgs(
    ['--operator', 'op', '--org', org, ...argv],
    rightsRequestCommandSpec,
  )
  if (!parsed.ok) throw new Error(parsed.error)
  const ctx = {
    operatorId: 'op',
    correlationId: 'c',
    organizationId: org,
    propertyId: parsed.args.propertyId,
    dryRun: !parsed.args.apply,
    batchSize: parsed.args.batchSize,
  } as unknown as OperatorContext
  const io: OperatorIO = { out: (l) => out.push(l), err: (l) => err.push(l) }
  const effects: RightsRequestEffects = {
    readFile: async () => '',
    writeExportFile: async (_path, bytes) => {
      exports.push(Buffer.from(bytes).toString('utf8'))
    },
    journal: createRightsJournal({
      put: async (key) => {
        journalWrites.push(key)
      },
      alert: () => {},
    }),
    auditWrite: async (event) => {
      if (auditFails) throw new Error('audit store down')
      audits.push(event)
    },
    subjectRefusal: async () => null,
    executors: (finalWarning) => [
      createNotificationRightsExecutor({
        finalWarning,
        tables: NOTIFICATION_RIGHTS_TABLES,
        run: (run) => runNotificationRights(port, run),
      }),
    ],
  }
  const code = await handleRightsRequest(effects, ctx, parsed.args, io)
  return { code, out, err, sent, deleted, exports, journalWrites, audits }
}

describe('notification: rights through the rights-request handler', () => {
  it('exports preferences, history and settings for one tenant only', async () => {
    const a = await runScript(seed(), ORG_A, ['access', 'out=/tmp/a'])
    const b = await runScript(seed(), ORG_B, ['access', 'out=/tmp/b'])

    expect(a.code).toBe(0)
    expect(a.out).toContain('notification: notifications: 2')
    expect(a.out).toContain('notification: preferences: 1')
    expect(a.exports[0]).toContain('A1 review')
    expect(a.exports[0]).toContain('p-a1')
    expect(a.exports[0]).not.toContain('B secret')
    expect(b.exports[0]).toContain('B secret')
    expect(b.exports[0]).not.toContain('A1 review')
    expect(a.out.join('\n')).not.toContain('A1 review')
  })

  it('restricts a Property run to that Property and leaves per-person settings out', async () => {
    const result = await runScript(seed(), ORG_A, ['property', '--property', PROPERTY_A1])
    expect(result.out).toContain('notification: notifications: 1')
    expect(result.out).toContain('notification: user settings: 0')
    expect(result.exports).toEqual([])
  })

  it('stops the run when a read returns another tenant, before any output', async () => {
    await expect(
      runScript(seed(), ORG_A, ['access', 'out=/tmp/a'], { tamper: true }),
    ).rejects.toThrow('another Organization')
  })

  it('plans final warnings with no Property for admins and former members', async () => {
    const report = await runScript(seed(), ORG_A, ['organization'])
    expect(report.out).toContain(
      'notification: final warning: 1 account admins, 2 former members, no Property',
    )
  })

  it('sends final warnings without a Property and reaches former members', async () => {
    const result = await runScript(seed(), ORG_A, [
      'organization',
      'final-warning',
      '--apply',
      '--reason',
      'closure',
      '--ticket',
      'T-1',
      '--yes',
      'ops:rights-request',
      ...VERIFIED,
      `confirm=ERASE ORGANIZATION ${ORG_A}`,
    ])
    expect(result.code).toBe(0)
    expect(result.deleted).toEqual([])
    expect(result.journalWrites).toEqual([])
    expect(result.sent).toHaveLength(1)
    const [warning] = result.sent
    expect(warning!.eventId).toBe(`manual-final-warning:${ORG_A}:ticket:123`)
    expect(warning!.notices.map((n) => n.userId).sort()).toEqual(['admin-a', 'former-a'])
    for (const notice of warning!.notices) {
      expect(notice.propertyId).toBeNull()
      expect(notice.organizationId).toBe(ORG_A)
      expect(notice.type).toBe('account.organization_purge_pending')
      expect(notice.resourceType).toBe('organization')
      expect(notice.resourceId).toBe(ORG_A)
      expect(notice.payload).toEqual({ organizationName: `Name of ${ORG_A}` })
    }
    const former = warning!.notices.find((n) => n.userId === 'former-a')
    expect(former?.audience).toEqual({
      kind: 'affected_organization_user',
      eventId: 'removal-a',
      eventType: 'identity.member.removed',
    })
    const admin = warning!.notices.find((n) => n.userId === 'admin-a')
    expect(admin?.audience).toEqual({ kind: 'account_admin' })
    expect(warning!.notices.every((n) => !String(n.userId).endsWith('-b'))).toBe(true)
  })

  it('sends nothing when the final warning runs without --apply', async () => {
    const result = await runScript(seed(), ORG_A, ['organization', 'final-warning'])
    expect(result.code).toBe(0)
    expect(result.sent).toEqual([])
    expect(result.deleted).toEqual([])
    expect(result.out).toContain(
      'notification: final warning: 1 account admins, 2 former members, no Property',
    )
  })

  const CLOSURE = [
    'organization',
    '--apply',
    '--reason',
    'closure',
    '--ticket',
    'T-1',
    '--yes',
    'ops:rights-request',
    ...VERIFIED,
  ]

  it('records one audit event for an applied closure, naming no content', async () => {
    const result = await runScript(seed(), ORG_A, [
      ...CLOSURE,
      `confirm=ERASE ORGANIZATION ${ORG_A}`,
    ])

    expect(result.code).toBe(0)
    expect(result.audits).toHaveLength(1)
    expect(result.audits[0]).toMatchObject({
      organizationId: ORG_A,
      propertyId: null,
      actorType: 'operator',
      actorId: 'op',
      action: 'rights.erase.organization',
      outcome: 'succeeded',
      sourceKind: 'operator_command',
    })
  })

  it('records a final warning as queued, not as an erasure', async () => {
    const result = await runScript(seed(), ORG_A, [
      ...CLOSURE,
      'final-warning',
      `confirm=ERASE ORGANIZATION ${ORG_A}`,
    ])

    expect(result.code).toBe(0)
    expect(result.audits.map((event) => event.action)).toEqual([
      'rights.final_warning.queued',
    ])
  })

  it('exits non-zero when the audit event cannot be written', async () => {
    const result = await runScript(
      seed(),
      ORG_A,
      [...CLOSURE, `confirm=ERASE ORGANIZATION ${ORG_A}`],
      { auditFails: true },
    )

    expect(result.code).toBe(1)
    expect(result.err.join('\n')).toContain('audit event could not be written')
  })

  it('purges only the named tenant, and a Property apply stays on its Property', async () => {
    const common = [
      '--apply',
      '--reason',
      'r',
      '--ticket',
      'T-1',
      '--yes',
      'ops:rights-request',
      ...VERIFIED,
    ]
    const org = await runScript(seed(), ORG_B, [
      'organization',
      ...common,
      `confirm=ERASE ORGANIZATION ${ORG_B}`,
    ])
    const property = await runScript(seed(), ORG_A, [
      'property',
      '--property',
      PROPERTY_A1,
      ...common,
      `confirm=ERASE PROPERTY ${PROPERTY_A1}`,
    ])
    expect(org.deleted).toEqual([`${ORG_B}/*`])
    expect(property.deleted).toEqual([`${ORG_A}/${PROPERTY_A1}`])
  })

  it('exports every Property for an Organization scope despite a stray Property id', async () => {
    const result = await runNotificationRights(fakePort(seed(), [], []), {
      scope: 'organization',
      mode: 'report',
      organizationId: ORG_A,
      propertyId: PROPERTY_A1,
      batchSize: 50,
      finalWarning: false,
    })

    expect(result.exportJson).toContain('A1 review')
    expect(result.exportJson).toContain('A2 review')
    expect(result.exportJson).not.toContain('B secret')
  })

  it('refuses to send final warnings for a single Property', async () => {
    await expect(
      runNotificationRights(fakePort(seed(), [], []), {
        scope: 'property',
        mode: 'apply',
        organizationId: ORG_A,
        propertyId: PROPERTY_A1,
        batchSize: 50,
        finalWarning: true,
      }),
    ).rejects.toThrow('Organization, not a Property')
  })
})

describe('buildManualFinalWarning', () => {
  const input = {
    organizationId: ORG_A,
    requestRef: 'ticket:1',
    payload: {},
    accountAdmins: ['admin-a', 'admin-a'],
    formerMembers: [
      { userId: 'former-a', removalEventId: 'removal-a' },
      { userId: 'admin-a', removalEventId: 'removal-x' },
    ],
  }

  it('is repeat-safe: the same request names the same source event', () => {
    expect(buildManualFinalWarning(input).eventId).toBe(
      buildManualFinalWarning(input).eventId,
    )
  })

  it('names one notice per recipient, an admin once even when also a former member', () => {
    const { notices } = buildManualFinalWarning(input)
    expect(notices.map((n) => n.userId)).toEqual(['admin-a', 'former-a'])
  })

  it('gives different requests different source events', () => {
    const event = (requestRef: string) =>
      buildManualFinalWarning({ ...input, requestRef }).eventId
    expect(event('ticket:1')).not.toEqual(event('ticket:2'))
  })
})
