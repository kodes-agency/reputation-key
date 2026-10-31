import {
  purgeAiDraftsForAuthorization,
  purgeAiDraftsForControl,
  purgeAiDraftsForOrganization,
  purgeAiDraftsForProperty,
  purgeAiDraftsForReview,
} from '#/shared/db/ai/ai-draft-purge'
import { carryDraftMeasurement } from '#/shared/db/ai/draft-measurement-lineage'
import { recordDraftGeneration } from '#/shared/db/ai/draft-generation-measurement'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { recordDraftMeasurementEvent } from '#/shared/db/ai/draft-measurement-events'
import { readDraftMeasurementReport } from '#/shared/db/ai/draft-measurement-report'
import {
  createReplyWorkflowHarness,
  WORKFLOW_HOOK_TIMEOUT_MS,
  WORKFLOW_ORG,
  WORKFLOW_PROPERTY,
  WORKFLOW_REVIEW,
  WORKFLOW_MANAGER,
  type ReplyWorkflowHarness,
} from './testing/reply-workflow-harness'

const DRAFT = 'Thank you for sharing your experience.'
const SECOND = 'We are glad you enjoyed your stay with us.'
const EDIT = 'Thank you for visiting. We hope to see you again.'
let pool: Pool
let harness: ReplyWorkflowHarness
beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 5 })
  clearEventSchemas()
  registerAllEventSchemas()
  harness = await createReplyWorkflowHarness({
    pool,
    locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    logger: createMockLogger(),
  })
  await harness.seed()
}, WORKFLOW_HOOK_TIMEOUT_MS)
afterAll(async () => {
  await harness.remove()
  clearEventSchemas()
  await pool.end()
}, WORKFLOW_HOOK_TIMEOUT_MS)
beforeEach(async () => {
  await harness.reset()
})

async function measurements() {
  return (
    await pool.query(
      'SELECT * FROM ai_draft_measurements WHERE organization_id = $1 ORDER BY created_at, id',
      [WORKFLOW_ORG],
    )
  ).rows
}
async function currentLink() {
  const reply = await harness.currentReply()
  if (!reply) throw new Error('Reply missing')
  const { rows } = await pool.query(
    'SELECT generation_id FROM ai_draft_measurement_links WHERE reply_id = $1 ORDER BY reply_revision DESC LIMIT 1',
    [reply.id],
  )
  return rows[0]?.generation_id
}

describe('content-free draft measurement through the reply workflow', () => {
  it('retains generation through first save, submit, dispatch and confirmed Google observation', async () => {
    await harness.commands.adoptAiSuggestion(DRAFT)
    const [generation] = await measurements()
    expect(generation.adopted_at).not.toBeNull()
    expect(generation.id).not.toBe(generation.operation_id)
    const saved = await harness.commands.draft(EDIT)
    expect(saved.aiGenerated).toBe(false)
    await getDb().transaction(async (tx) => {
      await carryDraftMeasurement(tx, saved, saved)
      await carryDraftMeasurement(tx, saved, saved)
    })
    expect(await measurements()).toHaveLength(1)
    expect(await currentLink()).toBe(generation.id)
    expect(
      (
        await pool.query('SELECT * FROM ai_draft_measurement_links WHERE reply_id = $1', [
          saved.id,
        ])
      ).rows,
    ).toHaveLength(1)
    await harness.commands.submit({
      generationId: generation.id,
      replyId: saved.id,
      replyRevision: saved.stateRevision,
      distance: 0.25,
    })
    expect((await measurements())[0]).toMatchObject({
      edit_distance: 0.25,
      edited_before_submit: true,
    })
    await harness.commands.approve()
    await harness.runPublishJob(0, 'accepted')
    expect((await measurements())[0].published_at).toBeNull()
    await harness.observeGoogle()
    const [published] = await measurements()
    expect(published.published_at).not.toBeNull()
    expect(await currentLink()).toBe(generation.id)
    const review = (
      await pool.query('SELECT text FROM reviews WHERE id = $1', [WORKFLOW_REVIEW])
    ).rows[0]
    const serialized = JSON.stringify(await measurements())
    for (const text of [DRAFT, EDIT, review.text])
      if (text) expect(serialized).not.toContain(text)
    expect(
      await readDraftMeasurementReport(getDb(), { propertyId: WORKFLOW_PROPERTY }),
    ).toMatchObject({ totals: 1, adopted: 1, published: 1 })
  })
  it('has no generation for a typed reply', async () => {
    await harness.commands.draft(EDIT)
    await harness.commands.submit()
    expect(await measurements()).toEqual([])
    expect(await currentLink()).toBeUndefined()
  })
  it('attributes replacement and Undo to previously adopted generations only', async () => {
    await harness.commands.adoptAiSuggestion(DRAFT)
    const first = await currentLink()
    await harness.commands.adoptAiSuggestion(SECOND)
    const second = await currentLink()
    expect(second).not.toBe(first)
    await harness.commands.draft(DRAFT, first)
    expect(await currentLink()).toBe(first)
    await harness.commands.draft(DRAFT, first)
    expect(await measurements()).toHaveLength(2)
    const reply = await harness.currentReply()
    expect(
      (
        await pool.query('SELECT * FROM ai_draft_measurement_links WHERE reply_id = $1', [
          reply!.id,
        ])
      ).rows,
    ).toHaveLength(3)
    await harness.commands.draft(EDIT, null)
    expect(await currentLink()).toBeNull()
  })
  it('reports unavailable on reload and ignores stale or unbounded metrics', async () => {
    await harness.commands.adoptAiSuggestion(DRAFT)
    const first = await harness.commands.draft(EDIT)
    const saved = await harness.commands.draft(EDIT + ' Thank you.')
    const [generation] = await measurements()
    await harness.commands.submit({
      generationId: generation.id,
      replyId: first.id,
      replyRevision: first.stateRevision,
      distance: 0,
    })
    expect(saved.stateRevision).toBeGreaterThan(first.stateRevision)
    expect((await measurements())[0]).toMatchObject({
      edit_distance: null,
      edited_before_submit: null,
    })
  })
  it('restores attribution for identical-text Undo at submit without another draft save', async () => {
    await harness.commands.adoptAiSuggestion(DRAFT)
    const first = await currentLink()
    await harness.commands.adoptAiSuggestion(DRAFT)
    const second = await currentLink()
    expect(second).not.toBe(first)
    const reply = await harness.currentReply()
    if (!reply) throw new Error('Reply missing')
    await harness.commands.submit({
      generationId: first,
      replyId: reply.id,
      replyRevision: reply.stateRevision,
      distance: 0,
    })
    const rows = await measurements()
    expect(rows.find((row) => row.id === first)).toMatchObject({
      edit_distance: 0,
      edited_before_submit: false,
    })
    expect(rows.find((row) => row.id === first)?.submitted_at).not.toBeNull()
    expect(rows.find((row) => row.id === second)?.submitted_at).toBeNull()
    expect(await currentLink()).toBe(first)
  })
  it('cannot bypass an AI withdrawal fence by clearing advisory measurement', async () => {
    await harness.commands.adoptAiSuggestion(DRAFT)
    await harness.ai.letWindowPass()
    const reply = await harness.currentReply()
    if (!reply) throw new Error('Reply missing')
    await expect(
      harness.commands.submit({
        generationId: null,
        replyId: reply.id,
        replyRevision: reply.stateRevision,
        distance: null,
      }),
    ).rejects.toMatchObject({ code: 'ai_suggestion_stale' })
    expect((await measurements())[0].submitted_at).toBeNull()
  })
  it('deduplicates advisory events and refuses other tenants and revisions', async () => {
    await harness.commands.adoptAiSuggestion(DRAFT)
    const [generation] = await measurements()
    const scope = {
      organizationId: WORKFLOW_ORG,
      propertyId: WORKFLOW_PROPERTY,
      reviewId: WORKFLOW_REVIEW,
      actorUserId: WORKFLOW_MANAGER,
    }
    const event = {
      generationId: generation.id,
      baseReplyRevision: Number(generation.base_reply_revision),
      event: 'shown' as const,
    }
    await recordDraftMeasurementEvent(getDb(), scope, event)
    const shown = (await measurements())[0].shown_at
    await recordDraftMeasurementEvent(getDb(), scope, event)
    await recordDraftMeasurementEvent(
      getDb(),
      { ...scope, organizationId: 'other-tenant' },
      { ...event, event: 'dismissed' },
    )
    await recordDraftMeasurementEvent(getDb(), scope, {
      ...event,
      baseReplyRevision: event.baseReplyRevision + 1,
      event: 'dismissed',
    })
    await recordDraftMeasurementEvent(getDb(), scope, { ...event, event: 'superseded' })
    expect((await measurements())[0]).toMatchObject({
      shown_at: shown,
      dismissed_at: null,
      superseded_at: null,
    })
  })
  it('retains typed reply measurement through a profile change while rejecting stale recording', async () => {
    await harness.commands.adoptAiSuggestion(DRAFT)
    const saved = await harness.commands.draft(EDIT)
    const [generation] = await measurements()
    await harness.ai.changeInput()
    expect((await measurements())[0].id).toBe(generation.id)
    expect(await currentLink()).toBe(generation.id)
    expect(
      (
        await pool.query('SELECT * FROM ai_draft_measurement_links WHERE reply_id = $1', [
          saved.id,
        ])
      ).rows,
    ).toHaveLength(1)
    expect((await harness.currentReply())?.text).toBe(EDIT)
    expect(
      await recordDraftGeneration(getDb(), {
        organizationId: WORKFLOW_ORG,
        propertyId: WORKFLOW_PROPERTY,
        reviewId: WORKFLOW_REVIEW,
        actorUserId: WORKFLOW_MANAGER,
        requestKey: generation.request_key,
        contract: 'v1',
        intent: 'explicit',
        trigger: 'draft',
        outcome: 'ready',
        refusalCode: null,
        case: null,
        latencyMs: 100,
      }),
    ).toBeNull()
  })
})

const generationInput = (requestKey: string) => ({
  organizationId: WORKFLOW_ORG,
  propertyId: WORKFLOW_PROPERTY,
  reviewId: WORKFLOW_REVIEW,
  actorUserId: WORKFLOW_MANAGER,
  requestKey,
  contract: 'v1' as const,
  intent: 'explicit' as const,
  trigger: 'draft' as const,
  outcome: 'ready' as const,
  refusalCode: null,
  case: null,
  latencyMs: 100,
})

it.each(['global', 'provider_deployment_profile', 'capability'] as const)(
  'retains measurements and typed reply links across %s control changes',
  async (scope) => {
    await harness.commands.adoptAiSuggestion(DRAFT)
    await harness.commands.draft(EDIT)
    const id = await currentLink()
    await getDb().transaction((tx) =>
      purgeAiDraftsForControl(tx, scope, 'reply_drafting'),
    )
    await getDb().transaction((tx) =>
      purgeAiDraftsForReview(tx, {
        organizationId: WORKFLOW_ORG,
        reviewId: WORKFLOW_REVIEW,
      }),
    )
    await getDb().transaction((tx) => purgeAiDraftsForOrganization(tx, WORKFLOW_ORG))
    expect(await currentLink()).toBe(id)
    expect((await measurements())[0].id).toBe(id)
  },
)

it.each(['authorization', 'property'] as const)(
  'erases measurements and links for %s withdrawal',
  async (scope) => {
    await harness.commands.adoptAiSuggestion(DRAFT)
    const reply = await harness.commands.draft(EDIT)
    await getDb().transaction((tx) =>
      (scope === 'authorization'
        ? purgeAiDraftsForAuthorization
        : purgeAiDraftsForProperty)(tx, {
        organizationId: WORKFLOW_ORG,
        propertyId: WORKFLOW_PROPERTY,
      }),
    )
    expect(await measurements()).toEqual([])
    expect(
      (
        await pool.query('SELECT * FROM ai_draft_measurement_links WHERE reply_id = $1', [
          reply.id,
        ])
      ).rows,
    ).toEqual([])
  },
)

it('skips a busy tenant measurement lock and does not contend with another organization', async () => {
  await harness.commands.adoptAiSuggestion(DRAFT)
  const [generation] = await measurements()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('ai-draft-measurement'), hashtext($1::text))",
      [WORKFLOW_ORG],
    )
    expect(
      await recordDraftGeneration(getDb(), generationInput(generation.request_key)),
    ).toBeNull()
    await client.query('ROLLBACK')
    await client.query('BEGIN')
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('ai-draft-measurement'), hashtext($1::text))",
      ['another-tenant'],
    )
    expect(
      await recordDraftGeneration(getDb(), generationInput(generation.request_key)),
    ).toBe(generation.id)
  } finally {
    await client.query('ROLLBACK')
    client.release()
  }
})

it('bounds recording behind a Property refresh row lock', async () => {
  await harness.commands.adoptAiSuggestion(DRAFT)
  const [generation] = await measurements()
  await pool.query('DELETE FROM ai_draft_measurements WHERE id = $1', [generation.id])
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT id FROM properties WHERE id = $1 FOR UPDATE', [
      WORKFLOW_PROPERTY,
    ])
    await expect(
      recordDraftGeneration(getDb(), generationInput(generation.request_key)),
    ).rejects.toMatchObject({ cause: { code: '55P03' } })
  } finally {
    await client.query('ROLLBACK')
    client.release()
  }
})
