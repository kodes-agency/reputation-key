import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import type {
  ReplyProfileWrite,
  ReplyTemplateWrite,
} from '../../application/ports/reply-template.repository'
import { createReplyTemplateRepository } from './reply-template.repository'

const ORG_A = organizationId('org-reply-library-aaaaaaaaaaaaaaaa')
const ORG_B = organizationId('org-reply-library-bbbbbbbbbbbbbbbb')
const PROPERTY_A = propertyId('72000000-0000-4000-8000-000000000001')
const PROPERTY_B = propertyId('72000000-0000-4000-8000-000000000002')
const NOW = new Date('2026-01-01T00:00:00.000Z')

let pool: Pool

async function clearFixtures(): Promise<void> {
  await pool.query(
    'DELETE FROM property_reply_templates WHERE organization_id = ANY($1)',
    [[ORG_A, ORG_B]],
  )
  await pool.query(
    'DELETE FROM property_reply_profiles WHERE organization_id = ANY($1)',
    [[ORG_A, ORG_B]],
  )
  await pool.query('DELETE FROM properties WHERE id = ANY($1)', [
    [PROPERTY_A, PROPERTY_B],
  ])
  await deleteTestOrganizations(pool, [ORG_A, ORG_B])
}

async function seedFixtures(): Promise<void> {
  for (const [organization, suffix] of [
    [ORG_A, 'a'],
    [ORG_B, 'b'],
  ] as const) {
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, $2, $3, NOW())`,
      [organization, `Reply Library ${suffix}`, `reply-library-${suffix}`],
    )
  }
  await pool.query(
    `INSERT INTO properties
       (id, organization_id, name, slug, timezone, default_reply_language, created_at, updated_at)
     VALUES
       ($1, $2, 'Library Property A', 'library-property-a', 'UTC', 'en-Latn-US', NOW(), NOW()),
       ($3, $4, 'Library Property B', 'library-property-b', 'UTC', 'bg-Cyrl-BG', NOW(), NOW())`,
    [PROPERTY_A, ORG_A, PROPERTY_B, ORG_B],
  )
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
})

beforeEach(async () => {
  await clearFixtures()
  await seedFixtures()
})

afterAll(async () => {
  await clearFixtures()
  await pool.end()
})

function profile(overrides: Partial<ReplyProfileWrite> = {}): ReplyProfileWrite {
  return {
    organizationId: ORG_A,
    propertyId: PROPERTY_A,
    greeting: 'Dear {guest_name},',
    signOffPositive: 'Warm regards',
    signOffNegative: 'Sincerely',
    emojiAllowed: false,
    escalationContact: 'care@example.test',
    updatedBy: 'ops:test',
    ...overrides,
  }
}

function template(overrides: Partial<ReplyTemplateWrite> = {}): ReplyTemplateWrite {
  return {
    organizationId: ORG_A,
    propertyId: PROPERTY_A,
    title: 'General positive',
    ratingMin: 4,
    ratingMax: 5,
    hasText: true,
    aspect: null,
    openLabel: null,
    languageTag: 'en-Latn',
    body: 'Thank you, {guest_name}.',
    enabled: true,
    updatedBy: 'ops:test',
    ...overrides,
  }
}

describe.sequential('reply template repository', () => {
  it('upserts profiles and templates idempotently and increments versions only on change', async () => {
    const repository = createReplyTemplateRepository(getDb(), () => NOW)

    const firstProfile = await repository.upsertProfile(profile())
    const sameProfile = await repository.upsertProfile(profile())
    const changedProfile = await repository.upsertProfile(
      profile({ greeting: 'Hello {guest_name},' }),
    )
    const firstTemplate = await repository.upsertTemplate(template())
    const sameTemplate = await repository.upsertTemplate(template())
    const changedTemplate = await repository.upsertTemplate(
      template({ body: 'We appreciate your visit, {guest_name}.' }),
    )
    const disabledTemplate = await repository.setTemplateEnabled({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      templateId: firstTemplate.value.id,
      enabled: false,
      updatedBy: 'user:manager',
    })
    const sameDisabledTemplate = await repository.setTemplateEnabled({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      templateId: firstTemplate.value.id,
      enabled: false,
      updatedBy: 'user:other',
    })

    expect(firstProfile).toMatchObject({ disposition: 'inserted', value: { version: 1 } })
    expect(sameProfile).toMatchObject({ disposition: 'unchanged', value: { version: 1 } })
    expect(changedProfile).toMatchObject({
      disposition: 'updated',
      value: { version: 2 },
    })
    expect(firstTemplate).toMatchObject({
      disposition: 'inserted',
      value: { version: 1 },
    })
    expect(sameTemplate).toMatchObject({
      disposition: 'unchanged',
      value: { version: 1 },
    })
    expect(changedTemplate).toMatchObject({
      disposition: 'updated',
      value: { version: 2 },
    })
    expect(disabledTemplate).toMatchObject({
      disposition: 'updated',
      value: { enabled: false, version: 3, updatedBy: 'user:manager' },
    })
    expect(sameDisabledTemplate).toMatchObject({
      disposition: 'unchanged',
      value: { enabled: false, version: 3, updatedBy: 'user:manager' },
    })
  })
  it('renames by id in place and re-importing the former title creates a separate row', async () => {
    const repository = createReplyTemplateRepository(getDb(), () => NOW)
    const imported = await repository.upsertTemplate(template())

    const renamed = await repository.updateTemplate({
      ...template({ title: 'Renamed appreciation', updatedBy: 'user:manager' }),
      templateId: imported.value.id,
    })
    const afterRename = await repository.listPropertyTemplates(ORG_A, PROPERTY_A)

    expect(renamed).toMatchObject({
      disposition: 'updated',
      value: {
        id: imported.value.id,
        title: 'Renamed appreciation',
        version: 2,
        updatedBy: 'user:manager',
      },
    })
    expect(afterRename).toHaveLength(1)

    const noOp = await repository.updateTemplate({
      ...template({ title: 'Renamed appreciation', updatedBy: 'user:other' }),
      templateId: imported.value.id,
    })
    const reimported = await repository.upsertTemplate(template())
    const afterReimport = await repository.listPropertyTemplates(ORG_A, PROPERTY_A)

    expect(noOp).toMatchObject({
      disposition: 'unchanged',
      value: { version: 2, updatedBy: 'user:manager' },
    })
    expect(reimported).toMatchObject({
      disposition: 'inserted',
      value: { title: 'General positive', version: 1 },
    })
    expect(afterReimport.map(({ title }) => title).sort()).toEqual([
      'General positive',
      'Renamed appreciation',
    ])
  })

  it('filters enabled templates by tenant, property, text presence, and rating band', async () => {
    const repository = createReplyTemplateRepository(getDb(), () => NOW)
    await repository.upsertTemplate(template())
    await repository.upsertTemplate(
      template({
        title: 'No-text positive',
        hasText: false,
        body: 'Thank you for the rating.',
      }),
    )
    await repository.upsertTemplate(
      template({
        title: 'Negative recovery',
        ratingMin: 1,
        ratingMax: 2,
        body: 'We are sorry, {guest_name}.',
      }),
    )
    await repository.upsertTemplate(template({ title: 'Disabled', enabled: false }))

    const applicable = await repository.findApplicableTemplates({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      rating: 5,
      hasText: true,
    })

    expect(applicable.map(({ title }) => title)).toEqual(['General positive'])
    expect(await repository.readDefaultReplyLanguage(ORG_A, PROPERTY_A)).toBe(
      'en-Latn-US',
    )
    expect(await repository.readDefaultReplyLanguage(ORG_B, PROPERTY_A)).toBeNull()
    expect(
      (await repository.listPropertyTemplates(ORG_A, PROPERTY_A)).map(
        ({ title, enabled }) => ({ title, enabled }),
      ),
    ).toEqual([
      { title: 'Negative recovery', enabled: true },
      { title: 'Disabled', enabled: false },
      { title: 'General positive', enabled: true },
      { title: 'No-text positive', enabled: true },
    ])
  })

  it('never returns a profile or template through another tenant/property tuple', async () => {
    const repository = createReplyTemplateRepository(getDb(), () => NOW)
    const createdProfile = await repository.upsertProfile(profile())
    const createdTemplate = await repository.upsertTemplate(template())

    expect(createdProfile.value.organizationId).toBe(ORG_A)
    expect(await repository.findProfile(ORG_B, PROPERTY_A)).toBeNull()
    expect(
      await repository.findEnabledTemplateById({
        organizationId: ORG_B,
        propertyId: PROPERTY_A,
        templateId: createdTemplate.value.id,
      }),
    ).toBeNull()
    expect(
      await repository.findEnabledTemplateById({
        organizationId: ORG_A,
        propertyId: PROPERTY_B,
        templateId: createdTemplate.value.id,
      }),
    ).toBeNull()
    expect(await repository.findPropertyOrganization(PROPERTY_A)).toBe(ORG_A)
  })

  it('validates slots, aspects, languages, and lengths before persistence', async () => {
    const repository = createReplyTemplateRepository(getDb(), () => NOW)

    await expect(
      repository.upsertTemplate(template({ body: 'Welcome to {property_name}.' })),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      repository.upsertTemplate(template({ aspect: 'spa' as never })),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      repository.upsertTemplate(template({ languageTag: 'english' })),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      repository.upsertTemplate(template({ body: 'x'.repeat(4097) })),
    ).rejects.toMatchObject({ code: 'invalid_reply' })
  })
})
