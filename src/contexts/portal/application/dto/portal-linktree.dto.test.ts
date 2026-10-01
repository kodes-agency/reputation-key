import { describe, expect, it } from 'vitest'
import { linkTextsFormSchema, linktreeTitlesFormSchema } from './portal-linktree.dto'

describe('linkTextsFormSchema', () => {
  const schema = linkTextsFormSchema(['en'])

  it('accepts a label and a line per language, trimmed', () => {
    const parsed = schema.parse({
      texts: [
        { locale: 'en', label: '  Olive Terrace menu ', line: ' Lunch and dinner ' },
        { locale: 'bg', label: '', line: '' },
      ],
    })

    expect(parsed.texts[0]).toEqual({
      locale: 'en',
      label: 'Olive Terrace menu',
      line: 'Lunch and dinner',
    })
  })

  it('requires the primary label, reporting it on that field', () => {
    const result = schema.safeParse({
      texts: [
        { locale: 'en', label: '   ', line: '' },
        { locale: 'bg', label: '', line: '' },
      ],
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([
      ['texts', 0, 'label'],
    ])
  })

  it('lets a language with nothing saved stay empty, but not one that has a text', () => {
    const withSavedBg = linkTextsFormSchema(['en', 'bg'])
    const result = withSavedBg.safeParse({
      texts: [
        { locale: 'en', label: 'Menu', line: '' },
        { locale: 'bg', label: '', line: '' },
      ],
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([
      ['texts', 1, 'label'],
    ])
  })

  it('bounds the label at 100 and the line at 160 characters', () => {
    expect(
      schema.safeParse({
        texts: [{ locale: 'en', label: 'a'.repeat(101), line: '' }],
      }).success,
    ).toBe(false)
    expect(
      schema.safeParse({
        texts: [{ locale: 'en', label: 'ok', line: 'a'.repeat(161) }],
      }).success,
    ).toBe(false)
    expect(
      schema.safeParse({
        texts: [{ locale: 'en', label: 'a'.repeat(100), line: 'a'.repeat(160) }],
      }).success,
    ).toBe(true)
  })
})

describe('linktreeTitlesFormSchema', () => {
  it('accepts an empty title, which means the default', () => {
    expect(
      linktreeTitlesFormSchema.safeParse({
        titles: [
          { locale: 'en', title: '' },
          { locale: 'bg', title: 'Около хотела' },
        ],
      }).success,
    ).toBe(true)
  })

  it('bounds a title at 60 characters', () => {
    expect(
      linktreeTitlesFormSchema.safeParse({
        titles: [{ locale: 'en', title: 'a'.repeat(61) }],
      }).success,
    ).toBe(false)
  })
})
