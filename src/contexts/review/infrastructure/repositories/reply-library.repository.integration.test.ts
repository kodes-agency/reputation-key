import { Pool } from 'pg'
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
