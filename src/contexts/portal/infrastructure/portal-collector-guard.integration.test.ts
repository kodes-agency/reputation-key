import { createPortalRatingGoalGuard } from '#/contexts/reporting/infrastructure/portal-rating-goal-guard'
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import { getDb } from '#/shared/db'
import { portals } from '#/shared/db/schema'
import { organizationId, portalId, propertyId, userId } from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { buildTestPortal } from '#/shared/testing/fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import {
  METRIC_DEFINITION_IDS,
  METRIC_VERSION_IDS,
} from '#/contexts/reporting/application/public-api'
import type { UpdatePortalCommand } from '../publication/portal-command-store-port.server'
import {
  portalArchived,
  portalDeleted,
  portalTokenRevoked,
  portalUpdated,
} from '../domain/events'
import { portalToRow } from './mappers/portal.mapper'
import { createAtomicPortalCommandStore } from '../publication/portal-command-store.server'

const ORG = organizationId('org-collector-fence-a')
const OTHER_ORG = organizationId('org-collector-fence-b')
const PROPERTY = propertyId('8a000000-0000-4000-8000-000000000001')
const PORTALS = [
  portalId('8b000000-0000-4000-8000-000000000001'),
  portalId('8b000000-0000-4000-8000-000000000002'),
] as const
const GROUP = '8c000000-0000-4000-8000-000000000001'
const ACTOR = userId('collector-fence-manager')
const BEFORE = new Date('2026-11-01T10:00:00Z')
const AFTER = new Date('2026-11-01T10:00:01Z')
type Mutation = 'skip' | 'disable' | 'archive'
type Subject = 'property' | 'portal_group' | 'portal'

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: [
    'outbox_events',
    'portal_page_edits',
    'portal_pending_content_changes',
    'goal_subject_assignments',
    'goal_program_versions',
    'goal_programs',
    'portal_group_memberships',
    'portal_groups',
    'portals',
    'properties',
  ],
})

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Reception', 'reception', 'UTC', $3, $3)`,
    [PROPERTY, ORG, BEFORE],
  )
  for (const [index, id] of PORTALS.entries()) {
    const portal = buildTestPortal({
      id,
      organizationId: ORG,
      propertyId: PROPERTY,
      entityId: PROPERTY,
      name: `Reception ${index + 1}`,
      slug: `reception-${index + 1}`,
      publicationState: 'published',
      skipPrivateRating: false,
      createdAt: BEFORE,
      updatedAt: BEFORE,
    })
    await getDb().insert(portals).values(portalToRow(portal))
  }
})

async function seedGoal(
  subject: Subject,
  options: Readonly<{
    metric?: 'portal_rating_count' | 'qualified_scans'
    status?: 'active' | 'ended'
    organizationId?: string
    propertyId?: string
  }> = {},
): Promise<void> {
  const metric = options.metric ?? 'portal_rating_count'
  const org = options.organizationId ?? ORG
  const property = options.propertyId ?? PROPERTY
  if (subject === 'portal_group') {
    await getPool().query(
      `INSERT INTO portal_groups (id, organization_id, property_id, name)
       VALUES ($1, $2, $3, 'Reception')`,
      [GROUP, ORG, PROPERTY],
    )
    for (const id of PORTALS) {
      await getPool().query(
        `INSERT INTO portal_group_memberships
           (organization_id, property_id, portal_id, portal_group_id, effective_from, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [ORG, PROPERTY, id, GROUP, BEFORE, ACTOR],
      )
    }
  }
  const program = randomUUID()
  const version = randomUUID()
  await getPool().query(
    `INSERT INTO goal_programs (id, organization_id, property_id, name, status, created_by)
     VALUES ($1, $2, $3, 'Private ratings', $4, $5)`,
    [program, org, property, options.status ?? 'active', ACTOR],
  )
  await getPool().query(
    `INSERT INTO goal_program_versions
       (id, program_id, organization_id, property_id, version, metric_definition_id,
        metric_definition_version_id, metric_key, metric_minimum_sample, target_value,
        property_timezone, effective_from, change_reason, created_by)
     VALUES ($1, $2, $3, $4, 1, $5, $6, $7, 0, 25,
             'UTC', $8, 'created', $9)`,
    [
      version,
      program,
      org,
      property,
      metric === 'qualified_scans'
        ? METRIC_DEFINITION_IDS.qualifiedScan
        : METRIC_DEFINITION_IDS.portalRatingCount,
      metric === 'qualified_scans'
        ? METRIC_VERSION_IDS.qualifiedScanGoal
        : METRIC_VERSION_IDS.portalRatingCountGoal,
      metric,
      BEFORE,
      ACTOR,
    ],
  )
  await getPool().query(
    `INSERT INTO goal_subject_assignments
       (id, program_id, program_version_id, organization_id, property_id, metric_key,
        subject_kind, property_subject_id, portal_group_id, portal_id, effective_from, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      randomUUID(),
      program,
      version,
      org,
      property,
      metric,
      subject,
      subject === 'property' ? property : null,
      subject === 'portal_group' ? GROUP : null,
      subject === 'portal' ? PORTALS[0] : null,
      BEFORE,
      ACTOR,
    ],
  )
}

function command(id: (typeof PORTALS)[number], mutation: Mutation): UpdatePortalCommand {
  const state =
    mutation === 'skip' ? 'published' : mutation === 'disable' ? 'disabled' : 'archived'
  return {
    organizationId: ORG,
    propertyId: PROPERTY,
    portalId: id,
    actorUserId: ACTOR,
    expectedUpdatedAt: BEFORE,
    revision: AFTER,
    occurredAt: AFTER,
    patch:
      mutation === 'skip' ? { skipPrivateRating: true } : { publicationState: state },
    ...(mutation === 'skip'
      ? {}
      : {
          publication: {
            kind: 'deactivate',
            reason: state as 'disabled' | 'archived',
            at: AFTER,
          } as const,
        }),
    ...(mutation === 'archive'
      ? {
          lifecycleEvent: portalArchived({
            organizationId: ORG,
            propertyId: PROPERTY,
            portalId: id,
            userId: ACTOR,
            sourceAggregateVersion: AFTER.toISOString(),
            occurredAt: AFTER,
          }),
        }
      : {}),
    event: portalUpdated({
      organizationId: ORG,
      propertyId: PROPERTY,
      portalId: id,
      previousPublicationState: 'published',
      publicationState: state,
      sourceAggregateVersion: AFTER.toISOString(),
      occurredAt: AFTER,
    }),
  }
}

async function waitForBothCommands(client: PoolClient): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    // The blocking transaction must see connections opened after its first poll.
    await client.query('SELECT pg_stat_clear_snapshot()')
    const { rows } = await client.query<{ waiting: number }>(
      `WITH RECURSIVE waiting AS (
         SELECT pid FROM pg_stat_activity
         WHERE pg_backend_pid() = ANY(pg_blocking_pids(pid))
         UNION
         SELECT activity.pid FROM pg_stat_activity activity
         JOIN waiting ON waiting.pid = ANY(pg_blocking_pids(activity.pid))
       ) SELECT count(*)::int AS waiting FROM waiting`,
    )
    if (rows[0]?.waiting === 2) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Both Portal commands did not reach their database fences')
}

describe.sequential('running rating goal collector protection', () => {
  it.each([
    ['property', 'skip'],
    ['property', 'disable'],
    ['property', 'archive'],
    ['portal_group', 'skip'],
    ['portal_group', 'disable'],
    ['portal_group', 'archive'],
  ] as const)(
    'keeps one collector when two %s collectors race to %s',
    async (subject, mutation) => {
      await seedGoal(subject)
      const client = await getPool().connect()
      const store = createAtomicPortalCommandStore(getDb(), createPortalRatingGoalGuard())
      let outcomes: Promise<PromiseSettledResult<void>[]> | undefined
      try {
        await client.query('BEGIN')
        // Holding both Portal rows exposes a missing Property fence: both checks
        // would otherwise see the other collector before either Portal changes.
        await client.query(
          'SELECT id FROM portals WHERE organization_id = $1 FOR UPDATE',
          [ORG],
        )
        outcomes = Promise.allSettled(
          PORTALS.map((id) => store.updatePortal(command(id, mutation))),
        )
        await waitForBothCommands(client)
      } finally {
        await client.query('ROLLBACK')
        client.release()
        if (outcomes) await outcomes
      }

      const results = await outcomes!
      expect(results.map(({ status }) => status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ])
      const refused = results.find((result) => result.status === 'rejected')
      expect(refused?.status === 'rejected' ? refused.reason : null).toMatchObject({
        code: 'goal_needs_collector',
      })
      const { rows } = await getPool().query(
        `SELECT
         count(*) FILTER (WHERE publication_state = 'published' AND NOT skip_private_rating)::int AS collectors,
         count(*) FILTER (WHERE updated_at = $2)::int AS changed,
         (SELECT count(*)::int FROM outbox_events WHERE organization_id = $1 AND event_type = 'portal.updated') AS facts
       FROM portals WHERE organization_id = $1`,
        [ORG, AFTER],
      )
      expect(rows).toEqual([{ collectors: 1, changed: 1, facts: 1 }])
    },
  )

  it.each(['skip', 'disable', 'archive'] as const)(
    'refuses to %s the collector named by a Portal goal',
    async (mutation) => {
      await seedGoal('portal')
      const store = createAtomicPortalCommandStore(getDb(), createPortalRatingGoalGuard())
      await expect(
        store.updatePortal(command(PORTALS[0], mutation)),
      ).rejects.toMatchObject({
        code: 'goal_needs_collector',
      })
      const { rows } = await getPool().query(
        `SELECT publication_state, skip_private_rating, updated_at,
        (SELECT count(*)::int FROM outbox_events WHERE organization_id = $1) AS facts
       FROM portals WHERE organization_id = $1 AND id = $2`,
        [ORG, PORTALS[0]],
      )
      expect(rows).toEqual([
        {
          publication_state: 'published',
          skip_private_rating: false,
          updated_at: BEFORE,
          facts: 0,
        },
      ])
    },
  )

  it.each(['skip', 'disable', 'archive'] as const)(
    'allows both collectors to %s when there is no running goal',
    async (mutation) => {
      const store = createAtomicPortalCommandStore(getDb(), createPortalRatingGoalGuard())
      await expect(
        Promise.all(PORTALS.map((id) => store.updatePortal(command(id, mutation)))),
      ).resolves.toEqual([undefined, undefined])
    },
  )
  it.each(['skip', 'disable', 'archive'] as const)(
    'allows both collectors to %s after the rating goal ends',
    async (mutation) => {
      await seedGoal('property', { status: 'ended' })
      const store = createAtomicPortalCommandStore(getDb(), createPortalRatingGoalGuard())
      await expect(
        Promise.all(PORTALS.map((id) => store.updatePortal(command(id, mutation)))),
      ).resolves.toEqual([undefined, undefined])
    },
  )

  it.each(['skip', 'disable', 'archive'] as const)(
    'allows ordinary scan-goal collectors to %s',
    async (mutation) => {
      await seedGoal('portal', { metric: 'qualified_scans' })
      const store = createAtomicPortalCommandStore(getDb(), createPortalRatingGoalGuard())
      await expect(
        store.updatePortal(command(PORTALS[0], mutation)),
      ).resolves.toBeUndefined()
    },
  )

  it.each(['portal', 'portal_group'] as const)(
    'retains the skip-switch safeguard for a staff %s scan target',
    async (subject) => {
      await seedGoal(subject, { metric: 'qualified_scans' })
      await getPool().query(
        "UPDATE portals SET kind = 'personal', public_name = 'Reception' WHERE organization_id = $1 AND id = $2",
        [ORG, PORTALS[0]],
      )
      const store = createAtomicPortalCommandStore(getDb(), createPortalRatingGoalGuard())
      await expect(store.updatePortal(command(PORTALS[0], 'skip'))).rejects.toMatchObject(
        {
          code: 'running_rating_goal',
        },
      )
    },
  )

  it('retains a staff Group scan safeguard when its personal member is archived', async () => {
    await seedGoal('portal_group', { metric: 'qualified_scans' })
    await getPool().query(
      "UPDATE portals SET kind = 'personal', public_name = 'Reception', publication_state = 'archived' WHERE organization_id = $1 AND id = $2",
      [ORG, PORTALS[0]],
    )
    const store = createAtomicPortalCommandStore(getDb(), createPortalRatingGoalGuard())
    await expect(store.updatePortal(command(PORTALS[1], 'skip'))).rejects.toMatchObject({
      code: 'running_rating_goal',
    })
  })

  it.each(['draft', 'disabled', 'archived', 'skipping'] as const)(
    'does not count a %s sibling as a rating collector',
    async (state) => {
      await seedGoal('property')
      await getPool().query(
        `UPDATE portals SET publication_state = $3, skip_private_rating = $4
         WHERE organization_id = $1 AND id = $2`,
        [
          ORG,
          PORTALS[1],
          state === 'skipping' ? 'published' : state,
          state === 'skipping',
        ],
      )
      const store = createAtomicPortalCommandStore(getDb(), createPortalRatingGoalGuard())
      await expect(
        store.updatePortal(command(PORTALS[0], 'disable')),
      ).rejects.toMatchObject({
        code: 'goal_needs_collector',
      })
    },
  )

  it.each([ORG, OTHER_ORG])(
    'ignores a goal at another Property in Organization %s',
    async (org) => {
      const otherProperty = randomUUID()
      await getPool().query(
        `INSERT INTO properties (id, organization_id, name, slug, timezone)
         VALUES ($1, $2, 'Other reception', 'other-reception', 'UTC')`,
        [otherProperty, org],
      )
      await seedGoal('property', { organizationId: org, propertyId: otherProperty })
      const store = createAtomicPortalCommandStore(getDb(), createPortalRatingGoalGuard())
      await expect(
        Promise.all(PORTALS.map((id) => store.updatePortal(command(id, 'disable')))),
      ).resolves.toEqual([undefined, undefined])
    },
  )

  it('allows a harmless settings change on a sole goal collector', async () => {
    await seedGoal('portal')
    const store = createAtomicPortalCommandStore(getDb(), createPortalRatingGoalGuard())
    const change = command(PORTALS[0], 'skip')
    await expect(
      store.updatePortal({ ...change, patch: { name: 'Main reception' } }),
    ).resolves.toBeUndefined()
  })

  it.each([true, false])(
    'soft deletion preserves the collector requirement when a rating goal exists: %s',
    async (hasGoal) => {
      if (hasGoal) await seedGoal('portal')
      const store = createAtomicPortalCommandStore(getDb(), createPortalRatingGoalGuard())
      const eventScope = {
        organizationId: ORG,
        propertyId: PROPERTY,
        portalId: PORTALS[0],
        sourceAggregateVersion: AFTER.toISOString(),
        occurredAt: AFTER,
      }
      const result = store.deletePortal({
        organizationId: ORG,
        propertyId: PROPERTY,
        portalId: PORTALS[0],
        expectedUpdatedAt: BEFORE,
        revokedBy: ACTOR,
        reason: 'Portal removed',
        revision: AFTER,
        occurredAt: AFTER,
        event: portalDeleted(eventScope),
        tokenRevokedEvent: portalTokenRevoked(eventScope),
      })
      if (hasGoal)
        await expect(result).rejects.toMatchObject({ code: 'goal_needs_collector' })
      else await expect(result).resolves.toEqual({ revoked: 0 })
      const { rows } = await getPool().query(
        `SELECT deleted_at, updated_at,
          (SELECT count(*)::int FROM outbox_events WHERE organization_id = $1) AS facts
         FROM portals WHERE organization_id = $1 AND id = $2`,
        [ORG, PORTALS[0]],
      )
      expect(rows).toEqual([
        {
          deleted_at: hasGoal ? null : AFTER,
          updated_at: hasGoal ? BEFORE : AFTER,
          facts: hasGoal ? 0 : 1,
        },
      ])
    },
  )
})
