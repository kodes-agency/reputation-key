import { reviews, replies } from '#/shared/db/schema'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { Pool } from 'pg'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { getDb, type Database } from '#/shared/db'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createReplyLibraryRepository } from './reply-library.repository'

const ORG = organizationId('org-reply-library-repository-0001')
const PROPERTY = propertyId('81000000-0000-4000-8000-000000000001')
const ACTOR = 'user-reply-library-repository-01'
const NOW = new Date('2026-10-30T08:00:00.000Z')

const db: Database = getDb()
const repository = createReplyLibraryRepository(db, () => NOW)
let pool: Pool

async function clean(): Promise<void> {
  await pool.query('DELETE FROM replies WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM reply_template_visibility WHERE organization_id = $1', [
    ORG,
  ])
  await pool.query(
    `DELETE FROM reply_template_wordings
     WHERE revision_id IN (
       SELECT revision.id FROM reply_template_revisions revision
       JOIN reply_templates template ON template.id = revision.template_id
       WHERE template.organization_id = $1
     )`,
    [ORG],
  )
  await pool.query(
    'UPDATE reply_templates SET current_revision_id = NULL WHERE organization_id = $1',
    [ORG],
  )
  await pool.query(
    `DELETE FROM reply_template_revisions
     WHERE template_id IN (SELECT id FROM reply_templates WHERE organization_id = $1)`,
    [ORG],
  )
  await pool.query('DELETE FROM reply_templates WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM property_reply_voices WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM organization_reply_voices WHERE organization_id = $1', [
    ORG,
  ])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
}

async function seed(): Promise<void> {
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Reply Library Repository', 'reply-library-repository', $2)`,
    [ORG, NOW],
  )
  await pool.query(
    `INSERT INTO properties (
       id, organization_id, name, slug, timezone, source_epoch,
       default_reply_language, created_at, updated_at
     ) VALUES ($1, $2, 'Harbor House', 'harbor-house-repository', 'UTC', 0,
               'en-Latn', $3, $3)`,
    [PROPERTY, ORG, NOW],
  )
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  const client = await pool.connect()
  client.release()
})

beforeEach(async () => {
  await clean()
  await seed()
})

afterAll(async () => {
  await clean()
  await pool.end()
})

describe.sequential('createReplyLibraryRepository (PostgreSQL)', () => {
  it('saves, loads, overrides, and resets account and Property voice fields', async () => {
    await expect(
      repository.saveVoice({
        organizationId: ORG,
        propertyId: PROPERTY,
        scope: 'account',
        set: { contact: 'manager@example.test', signerName: 'Ana Ruiz' },
        reset: [],
        localized: {
          'en-Latn': { closings: { negative: ['Thank you for telling us.'] } },
        },
        expectedVersion: 0,
        actorId: ACTOR,
      }),
    ).resolves.toMatchObject({
      version: 1,
      contact: 'manager@example.test',
      signerName: 'Ana Ruiz',
      overriddenFields: expect.arrayContaining(['contact', 'signerName']),
    })

    await expect(
      repository.saveVoice({
        organizationId: ORG,
        propertyId: PROPERTY,
        scope: 'property',
        set: { contact: null, useFirstName: false },
        reset: [],
        expectedVersion: 0,
        actorId: ACTOR,
      }),
    ).resolves.toMatchObject({
      version: 1,
      contact: null,
      useFirstName: false,
    })

    await expect(
      repository.saveVoice({
        organizationId: ORG,
        propertyId: PROPERTY,
        scope: 'property',
        set: { signerTitle: 'General Manager' },
        reset: ['contact'],
        expectedVersion: 1,
        actorId: ACTOR,
      }),
    ).resolves.toMatchObject({
      version: 2,
      signerTitle: 'General Manager',
      overriddenFields: expect.not.arrayContaining(['contact']),
    })

    const snapshot = await repository.loadSnapshot(ORG, PROPERTY)
    expect(snapshot).toMatchObject({
      propertyName: 'Harbor House',
      defaultReplyLanguage: 'en-Latn',
      accountVoice: {
        version: 1,
        contact: 'manager@example.test',
        localized: {
          'en-Latn': { closings: { negative: ['Thank you for telling us.'] } },
        },
      },
      propertyVoice: {
        version: 2,
        useFirstName: false,
        signerTitle: 'General Manager',
      },
    })
    expect(snapshot?.propertyVoice?.overriddenFields).not.toContain('contact')

    await expect(
      repository.saveVoice({
        organizationId: ORG,
        propertyId: PROPERTY,
        scope: 'property',
        set: { useFirstName: false, signerTitle: 'General Manager' },
        reset: [],
        expectedVersion: 2,
        actorId: 'another-user',
      }),
    ).resolves.toMatchObject({ version: 2 })
    await expect(
      pool.query<{ updated_by: string }>(
        `SELECT updated_by FROM property_reply_voices
         WHERE organization_id = $1 AND property_id = $2`,
        [ORG, PROPERTY],
      ),
    ).resolves.toMatchObject({ rows: [{ updated_by: ACTOR }] })
  })

  it('merges a later wording save into earlier ones instead of replacing them', async () => {
    const first = await repository.saveVoice({
      organizationId: ORG,
      propertyId: PROPERTY,
      scope: 'property',
      set: {},
      reset: [],
      localized: { 'en-Latn': { closings: { negative: ['Thank you for telling us.'] } } },
      expectedVersion: 0,
      actorId: ACTOR,
    })
    if (first === 'version_conflict') throw new Error('first save conflicted')
    const second = await repository.saveVoice({
      organizationId: ORG,
      propertyId: PROPERTY,
      scope: 'property',
      set: {},
      reset: [],
      localized: { 'es-Latn': { closings: { negative: ['Gracias por informarnos.'] } } },
      expectedVersion: first.version,
      actorId: ACTOR,
    })
    if (second === 'version_conflict') throw new Error('second save conflicted')
    expect(second.localized).toMatchObject({
      'en-Latn': { closings: { negative: ['Thank you for telling us.'] } },
      'es-Latn': { closings: { negative: ['Gracias por informarnos.'] } },
    })
  })

  it('revises templates, customizes built-ins, hides and shows refs, and resets customizations', async () => {
    const created = await repository.saveTemplate({
      organizationId: ORG,
      propertyId: PROPERTY,
      scope: 'account',
      title: 'Account welcome',
      starsMin: 4,
      starsMax: 5,
      reviewKind: 'text',
      topic: null,
      wordings: [{ key: 'one', languageGroup: 'en-Latn', body: 'Thank you.' }],
      actorId: ACTOR,
    })
    expect(created).toMatchObject({ revision: 1, title: 'Account welcome' })
    if (typeof created === 'string') throw new Error(`unexpected refusal: ${created}`)

    await expect(
      repository.saveTemplate({
        organizationId: ORG,
        propertyId: PROPERTY,
        scope: 'account',
        templateId: created.id,
        title: 'Account welcome revised',
        starsMin: 4,
        starsMax: 5,
        reviewKind: 'text',
        topic: null,
        wordings: [{ key: 'two', languageGroup: 'en-Latn', body: 'Thank you again.' }],
        expectedVersion: 1,
        actorId: ACTOR,
      }),
    ).resolves.toMatchObject({ revision: 2, title: 'Account welcome revised' })

    await expect(
      repository.saveTemplate({
        organizationId: ORG,
        propertyId: PROPERTY,
        scope: 'account',
        templateId: created.id,
        title: 'Account welcome revised',
        starsMin: 4,
        starsMax: 5,
        reviewKind: 'text',
        topic: null,
        wordings: [{ key: 'two', languageGroup: 'en-Latn', body: 'Thank you again.' }],
        expectedVersion: 2,
        actorId: 'another-user',
      }),
    ).resolves.toMatchObject({ revision: 2 })
    await expect(
      pool.query<{ count: string; updated_by: string }>(
        `SELECT COUNT(revision.id)::text AS count, template.updated_by
         FROM reply_templates template
         JOIN reply_template_revisions revision ON revision.template_id = template.id
         WHERE template.id = $1
         GROUP BY template.updated_by`,
        [created.id],
      ),
    ).resolves.toMatchObject({ rows: [{ count: '2', updated_by: ACTOR }] })

    const customized = await repository.saveTemplate({
      organizationId: ORG,
      propertyId: PROPERTY,
      scope: 'property',
      base: 'builtin:P-GEN',
      title: 'Property positive',
      starsMin: 4,
      starsMax: 5,
      reviewKind: 'text',
      topic: null,
      wordings: [{ key: 'one', languageGroup: 'en-Latn', body: 'We appreciate it.' }],
      actorId: ACTOR,
    })
    expect(customized).toMatchObject({
      builtinKey: 'P-GEN',
      basedOnBuiltinVersion: 1,
      revision: 1,
    })

    await repository.setHidden({
      organizationId: ORG,
      propertyId: PROPERTY,
      scope: 'property',
      ref: 'builtin:P-GEN',
      hidden: true,
      actorId: ACTOR,
    })
    expect((await repository.loadSnapshot(ORG, PROPERTY))?.visibility).toEqual([
      { propertyId: PROPERTY, ref: 'builtin:P-GEN' },
    ])
    await repository.setHidden({
      organizationId: ORG,
      propertyId: PROPERTY,
      scope: 'property',
      ref: 'builtin:P-GEN',
      hidden: false,
      actorId: ACTOR,
    })
    expect((await repository.loadSnapshot(ORG, PROPERTY))?.visibility).toEqual([])

    await expect(
      repository.archiveCustomization({
        organizationId: ORG,
        propertyId: PROPERTY,
        scope: 'property',
        ref: 'builtin:P-GEN',
        actorId: ACTOR,
      }),
    ).resolves.toBe(true)
    expect((await repository.loadSnapshot(ORG, PROPERTY))?.propertyTemplates).toEqual([])
  })
})

describe.sequential('AI frame reservations (PostgreSQL)', () => {
  const scope = {
    organizationId: ORG,
    propertyId: PROPERTY,
    languageGroup: 'en-Latn',
    ratingBand: 'positiveText' as const,
    voiceDigest: 'a'.repeat(64),
    nowEpochMillis: NOW.getTime(),
    optionCounts: { closing: 3, signOff: 3, contactSentence: 3, emoji: 0 },
  }
  it('allows a frame reservation while an import holds the Property foreign-key lock', async () => {
    const importing = await pool.connect()
    try {
      await importing.query('BEGIN')
      await importing.query('SELECT id FROM properties WHERE id = $1 FOR KEY SHARE', [
        PROPERTY,
      ])
      // The pending FK check must not block the generation's Property fence.
      const reserved = await repository.reserveAiFrame!({
        ...scope,
        generationSeed: 'f'.repeat(64),
      })
      expect(reserved).not.toBeNull()
    } finally {
      await importing.query('ROLLBACK')
      importing.release()
    }
  })

  it('serializes concurrent generations and rotates unpublished regeneration', async () => {
    const frames = await Promise.all(
      [0, 1, 2].map((n) =>
        repository.reserveAiFrame!({ ...scope, generationSeed: String(n).repeat(64) }),
      ),
    )
    expect(new Set(frames.map((frame) => frame!.choices.closing)).size).toBe(3)
    expect(new Set(frames.map((frame) => frame!.choices.signOff)).size).toBe(3)
    const replay = await repository.reserveAiFrame!({
      ...scope,
      generationSeed: '0'.repeat(64),
    })
    expect(replay).toEqual(frames[0])
    const next = await repository.reserveAiFrame!({
      ...scope,
      generationSeed: '3'.repeat(64),
      nowEpochMillis: NOW.getTime() + 1,
    })
    expect(next!.closingOrder).toHaveLength(3)
    expect(next!.choices.closing).not.toBe(frames[2]!.choices.closing)
  })
  it('keeps a published option in its recorded band after the source rating changes', async () => {
    const ids = [
      '81000000-0000-4000-8000-000000000031',
      '81000000-0000-4000-8000-000000000032',
    ]
    for (const [index, id] of ids.entries()) {
      await db.insert(reviews).values({
        id,
        organizationId: ORG,
        propertyId: PROPERTY,
        platform: 'google',
        externalId: `frame-band-${index}`,
        externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
        rating: 1,
        text: 'The review now has a low rating.',
        reviewedAt: NOW,
        sourceEpoch: 0,
        sourceRevision: 1,
        analysisSequence: 1,
      })
      await db.insert(replies).values({
        organizationId: ORG,
        reviewId: id,
        source: 'internal',
        text: 'A historical template reply.',
        status: 'published',
        authorship: 'human',
        aiGenerated: false,
        createdBy: ACTOR,
        replyLanguageTag: 'en-Latn',
        templateLayer: 'builtin',
        templateRef: 'builtin:frame-band',
        templateRevision: 1,
        templateWordingKey: 'wording',
        voiceDigest: scope.voiceDigest,
        voiceChoices: {
          closing: index,
          signOff: 0,
          contactSentence: 0,
          emoji: 0,
          includeContact: true,
          ratingBand: index === 0 ? 'positiveText' : 'negative',
        },
        publishedAt: new Date(NOW.getTime() - index * 60_000),
      })
    }
    const selected = await repository.reserveAiFrame!({
      ...scope,
      ratingBand: 'negative',
      generationSeed: 'd'.repeat(64),
      optionCounts: { closing: 2, signOff: 1, contactSentence: 1, emoji: 0 },
    })
    expect(selected!.choices.closing).toBe(0)
    await db.delete(replies).where(eq(replies.organizationId, ORG))
    await db.delete(reviews).where(eq(reviews.organizationId, ORG))
  })
  it('separates language, band and configuration and handles zero options', async () => {
    const empty = await repository.reserveAiFrame!({
      ...scope,
      optionCounts: { closing: 0, signOff: 0, contactSentence: 0, emoji: 0 },
      generationSeed: '4'.repeat(64),
    })
    expect(empty).toMatchObject({ closingOrder: [], choices: { closing: -1, emoji: 0 } })
    const other = await repository.reserveAiFrame!({
      ...scope,
      languageGroup: 'bg-Cyrl',
      ratingBand: 'negative',
      voiceDigest: 'b'.repeat(64),
      generationSeed: '4'.repeat(64),
    })
    expect(other!.closingOrder).toHaveLength(3)
  })
})
