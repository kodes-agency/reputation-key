import { describe, expect, it } from 'vitest'
import { replyDraftOrigin } from './reply-draft-origin'

const TEMPLATE_ID = '73000000-0000-4000-8000-000000000001'

describe('reply draft origin (row 18 result tag)', () => {
  it('has no tag for a hand-typed draft that nothing was adopted into', () => {
    expect(
      replyDraftOrigin({
        hasAiDraft: false,
        adoption: null,
        savedLanguageTag: 'bg-Cyrl',
      }),
    ).toBeNull()
  })

  it('names the saved language for an AI draft that survived a reload', () => {
    expect(
      replyDraftOrigin({ hasAiDraft: true, adoption: null, savedLanguageTag: 'bg-Cyrl' }),
    ).toEqual({ kind: 'ai_draft', languageTag: 'bg-Cyrl' })
  })

  it('names the language an adopted AI draft was written in', () => {
    expect(
      replyDraftOrigin({
        hasAiDraft: true,
        adoption: { kind: 'personalized', languageTag: 'tr-Latn', template: null },
        savedLanguageTag: 'bg-Cyrl',
      }),
    ).toEqual({ kind: 'ai_draft', languageTag: 'tr-Latn' })
  })

  it('names the library template and its language', () => {
    expect(
      replyDraftOrigin({
        hasAiDraft: false,
        adoption: {
          kind: 'library_template',
          languageTag: 'bg-Cyrl',
          template: { templateId: TEMPLATE_ID, title: 'Guest appreciation' },
        },
        savedLanguageTag: null,
      }),
    ).toEqual({
      kind: 'template',
      templateId: TEMPLATE_ID,
      title: 'Guest appreciation',
      languageTag: 'bg-Cyrl',
    })
  })

  it('keeps the template tag without a title when the id did not resolve', () => {
    expect(
      replyDraftOrigin({
        hasAiDraft: false,
        adoption: {
          kind: 'library_template',
          languageTag: 'bg-Cyrl',
          template: { templateId: TEMPLATE_ID, title: null },
        },
        savedLanguageTag: null,
      }),
    ).toEqual({
      kind: 'template',
      templateId: TEMPLATE_ID,
      title: null,
      languageTag: 'bg-Cyrl',
    })
  })

  it('reads a local safe template as a template with no id and no title', () => {
    expect(
      replyDraftOrigin({
        hasAiDraft: false,
        adoption: { kind: 'local_fallback', languageTag: 'bg-Cyrl', template: null },
        savedLanguageTag: null,
      }),
    ).toEqual({ kind: 'template', templateId: null, title: null, languageTag: 'bg-Cyrl' })
  })

  it('lets a later template adoption replace an AI draft seeded from the saved reply', () => {
    expect(
      replyDraftOrigin({
        // `hasAiDraft` is set false by the same adoption; the adoption decides.
        hasAiDraft: false,
        adoption: {
          kind: 'library_template',
          languageTag: 'en-Latn',
          template: { templateId: TEMPLATE_ID, title: 'Guest appreciation' },
        },
        savedLanguageTag: 'bg-Cyrl',
      }),
    ).toMatchObject({ kind: 'template', languageTag: 'en-Latn' })
  })
})
