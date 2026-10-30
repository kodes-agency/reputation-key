import { describe, expect, it } from 'vitest'
import { BUILTIN_REPLY_LIBRARY } from '#/shared/reply-library/builtin-library'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { StoredReplyTemplate } from './ports/reply-library.repository'
import { resolveReplyLibraryTemplates } from './reply-library-resolver'

const ORG = organizationId('org-1')
const PROPERTY = propertyId('10000000-0000-4000-8000-000000000001')

function stored(overrides: Partial<StoredReplyTemplate>): StoredReplyTemplate {
  return {
    id: '20000000-0000-4000-8000-000000000001',
    organizationId: ORG,
    propertyId: null,
    builtinKey: null,
    basedOnTemplateId: null,
    basedOnBuiltinVersion: null,
    revisionId: '30000000-0000-4000-8000-000000000001',
    revision: 1,
    revisionCreatedAt: new Date('2026-10-01T00:00:00Z'),
    title: 'Custom account template',
    starsMin: 5,
    starsMax: 5,
    reviewKind: 'text',
    topic: null,
    wordings: [{ key: '1', languageGroup: 'en-Latn', body: 'Account body.' }],
    ...overrides,
  }
}

describe('resolveReplyLibraryTemplates', () => {
  it('applies built-in, account, hide, property customization, property template, and property hide in order', () => {
    const accountCustom = stored({ id: '20000000-0000-4000-8000-000000000010' })
    const accountBuiltin = stored({
      id: '20000000-0000-4000-8000-000000000011',
      builtinKey: 'RO5',
      basedOnBuiltinVersion: 1,
      title: 'Account five stars',
    })
    const propertyBuiltin = stored({
      id: '20000000-0000-4000-8000-000000000012',
      propertyId: PROPERTY,
      builtinKey: 'RO4',
      basedOnBuiltinVersion: 1,
      title: 'Property four stars',
    })
    const propertyAccountCustomization = stored({
      id: '20000000-0000-4000-8000-000000000013',
      propertyId: PROPERTY,
      basedOnTemplateId: accountCustom.id,
      title: 'Property account customization',
      revisionCreatedAt: new Date('2026-10-02T00:00:00Z'),
    })
    const propertyOnly = stored({
      id: '20000000-0000-4000-8000-000000000014',
      propertyId: PROPERTY,
      title: 'Only here',
    })

    const templates = resolveReplyLibraryTemplates({
      builtin: BUILTIN_REPLY_LIBRARY,
      accountTemplates: [accountBuiltin, accountCustom],
      propertyTemplates: [propertyBuiltin, propertyAccountCustomization, propertyOnly],
      visibility: [
        { propertyId: null, ref: 'builtin:RO4' },
        { propertyId: PROPERTY, ref: `template:${propertyOnly.id}` },
      ],
    })

    expect(templates.find(({ ref }) => ref === 'builtin:RO5')).toMatchObject({
      layer: 'account',
      title: 'Account five stars',
      status: 'customized',
      essential: true,
      baseChanged: false,
    })
    expect(templates.find(({ ref }) => ref === 'builtin:RO4')).toMatchObject({
      layer: 'property',
      title: 'Property four stars',
      status: 'customized',
    })
    expect(
      templates.find(({ ref }) => ref === `template:${accountCustom.id}`),
    ).toMatchObject({
      layer: 'property',
      title: 'Property account customization',
      status: 'customized',
    })
    expect(
      templates.find(({ ref }) => ref === `template:${propertyOnly.id}`)?.status,
    ).toBe('hidden')
  })

  it('flags a customization when its base revision moved', () => {
    const account = stored({
      revision: 2,
      revisionCreatedAt: new Date('2026-10-03T00:00:00Z'),
    })
    const property = stored({
      id: '20000000-0000-4000-8000-000000000099',
      propertyId: PROPERTY,
      basedOnTemplateId: account.id,
      revisionCreatedAt: new Date('2026-10-02T00:00:00Z'),
    })
    const result = resolveReplyLibraryTemplates({
      builtin: BUILTIN_REPLY_LIBRARY,
      accountTemplates: [account],
      propertyTemplates: [property],
      visibility: [],
    })
    expect(result.find(({ ref }) => ref === `template:${account.id}`)?.baseChanged).toBe(
      true,
    )
  })
})
