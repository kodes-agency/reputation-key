import { describe, expect, it } from 'vitest'
import type { ReplyLibraryTemplateDto } from '#/contexts/review/application/dto/reply-library.dto'
import { storyAction, replyLibraryFixture } from './reply-library.stories.fixtures'
import {
  defaultWordings,
  editorDefaults,
  templateActionScope,
} from './reply-template-editor'
import { normalizeTemplateInput } from './reply-template-editor-form'

const PROPERTY_ID = '10000000-0000-4000-8000-000000000101'
const TEMPLATE_ID = '20000000-0000-4000-8000-000000000101'
const library = replyLibraryFixture()

function template(overrides: Partial<ReplyLibraryTemplateDto> = {}) {
  return {
    ...library.templates[0]!,
    ...overrides,
  }
}

function defaults(subject: ReplyLibraryTemplateDto, propertyCount: number) {
  return editorDefaults({
    propertyId: PROPERTY_ID,
    propertyName: 'Harbor Hotel',
    propertyCount,
    library,
    template: subject,
    action: storyAction(library),
  })
}

describe('editorDefaults', () => {
  it('customizes a built-in without sending a version from another layer', () => {
    expect(defaults(template(), 2)).toMatchObject({
      scope: 'property',
      base: library.templates[0]!.ref,
    })
    expect(defaults(template(), 2)).not.toHaveProperty('expectedVersion')
  })

  it('sends a version only when editing the template at its save layer', () => {
    const customized = template({ layer: 'property', revision: 4, status: 'customized' })
    expect(defaults(customized, 2)).toMatchObject({
      scope: 'property',
      base: customized.ref,
      expectedVersion: 4,
    })
  })

  it('recognizes a hidden own template by ref rather than status', () => {
    const hidden = template({
      ref: `template:${TEMPLATE_ID}`,
      layer: 'property',
      revision: 3,
      status: 'hidden',
    })
    expect(defaults(hidden, 1)).toMatchObject({
      scope: 'property',
      templateId: TEMPLATE_ID,
      expectedVersion: 3,
    })
    expect(defaults(hidden, 1)).not.toHaveProperty('base')
  })

  it('keeps inherited account templates property-scoped in a multi-property account', () => {
    const account = template({
      ref: `template:${TEMPLATE_ID}`,
      layer: 'account',
      status: 'yours',
    })
    expect(templateActionScope(account, 2)).toBe('property')
    expect(defaults(account, 2)).toMatchObject({ scope: 'property', base: account.ref })
    expect(defaults(account, 2)).not.toHaveProperty('expectedVersion')
  })
})

describe('template wording editor rows', () => {
  it('keeps languages hidden by the editor and supplies visible blank rows', () => {
    const wordings = defaultWordings(
      template({
        wordings: { 'bg-Cyrl': [{ key: 'legacy', body: 'Благодарим ви.' }] },
      }),
    )
    expect(wordings).toEqual([
      { key: 'legacy', languageGroup: 'bg-Cyrl', body: 'Благодарим ви.' },
      { key: 'legacy', languageGroup: 'en-Latn', body: '' },
      { key: 'legacy', languageGroup: 'es-Latn', body: '' },
    ])
  })

  it('drops blank language rows before submitting', () => {
    const input = defaults(template(), 1)
    expect(
      normalizeTemplateInput({
        ...input,
        wordings: [
          { key: 'one', languageGroup: 'en-Latn', body: 'Thank you.' },
          { key: 'one', languageGroup: 'es-Latn', body: '   ' },
        ],
      }).wordings,
    ).toEqual([{ key: 'one', languageGroup: 'en-Latn', body: 'Thank you.' }])
  })
})
