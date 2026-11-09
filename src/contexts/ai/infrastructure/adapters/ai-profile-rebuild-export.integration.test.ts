import { replyScopeEffects } from '#/contexts/reputation/application/public-api'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { aiPropertyAggregateHeads, properties } from '#/shared/db/schema'
import { createV3Seed, mentionOf } from '../testing/ai-v3-seed'
import { createPropertyProcessingProfileAdapter } from './property-processing-profile.adapter'
import { createAiGuestVoiceFactsAdapter } from './ai-guest-voice-facts.adapter'
import { createAiOrganizationExportContributor } from './ai-organization-export.adapter'
import { createAiProfileRebuild } from './ai-profile-rebuild'

const db = getDb()
const IDS = {
  organizationId: 'ai-profile-rebuild-export-test',
  propertyId: '7b300000-0000-4000-8000-000000000001',
  idPrefix: '7b300000',
}
const seed = createV3Seed(db, IDS)
const period = { startLocalDate: '2026-10-19', endLocalDate: '2026-10-21' }

async function rollover(timezone: string) {
  await db.update(properties).set({ timezone }).where(eq(properties.id, IDS.propertyId))
  const result = await createPropertyProcessingProfileAdapter(
    db,
    () => new Date(),
    replyScopeEffects,
  ).refreshForAi(seed.scope)
  if (result.status !== 'available') throw new Error('Missing rolled profile')
  return result.profile.profileVersion
}

async function exportedRecords(path: string) {
  const { entries } = await createAiOrganizationExportContributor(db).contribute({
    organizationId: IDS.organizationId,
    requestId: crypto.randomUUID(),
    asOf: new Date(),
  })
  const entry = entries.find((candidate) => candidate.path === path)
  if (!entry) throw new Error(`Missing export entry ${path}`)
  const document = JSON.parse(Buffer.from(entry.bytes).toString('utf8')) as {
    records: readonly { review_id: string }[]
  }
  return document.records
}

describe.sequential('profile rebuild and the Organization export', () => {
  beforeEach(async () => {
    await seed.setUp()
    for (const index of [1, 2, 3]) {
      await seed.addReview({
        index,
        rating: 2,
        reviewedAt: new Date('2026-10-20T01:00:00Z'),
        mentions: [
          mentionOf({
            topic: 'staff_service',
            polarity: 'negative',
            thing: 'service',
            issue: 'slow',
          }),
        ],
      })
    }
    await seed.seal()
  })
  afterEach(() => seed.tearDown())

  it('exports the analyses and mentions the product serves once a rebuild moved them to the rolled profile', async () => {
    expect(await exportedRecords('ai/review-analyses.json')).toHaveLength(3)
    await rollover('Europe/Sofia')
    await createAiProfileRebuild(db).sweep()
    expect(await exportedRecords('ai/review-analyses.json')).toHaveLength(3)
    expect(await exportedRecords('ai/review-analysis-mentions.json')).toHaveLength(3)
  })

  it('rebuilds a Property that rolled without a head for its current profile', async () => {
    const version = await rollover('Europe/Sofia')
    await db.delete(aiPropertyAggregateHeads).where(
      sql`${aiPropertyAggregateHeads.propertyId} = ${IDS.propertyId}::uuid
          AND ${aiPropertyAggregateHeads.propertyProfileVersion} = ${version}`,
    )
    await createAiProfileRebuild(db).sweep()
    const rebuilt = await createAiGuestVoiceFactsAdapter(db).readFacts(
      { ...seed.scope, propertyProfileVersion: version },
      period,
    )
    expect(rebuilt?.coverage.awaitingAnalysisCount).toBe(0)
    expect(rebuilt?.reviews).toHaveLength(3)
  })
})
