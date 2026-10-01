import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GUEST_LOCALES, type GuestLocale } from '#/shared/domain/guest-locale'
import { bgV2 } from '../language-packs/bg-v2'
import { enV2 } from '../language-packs/en-v2'
import {
  GuestLanguageSwitcher,
  InertLanguageChip,
  type GuestLanguageSwitcherProps,
} from './guest-language-switcher'

function render(props: Partial<GuestLanguageSwitcherProps> = {}) {
  return renderToStaticMarkup(
    createElement(GuestLanguageSwitcher, {
      locales: ['en', 'bg'],
      selectedLocale: 'en',
      token: 'tok_abc',
      accessArtifactId: undefined,
      copy: enV2.copy,
      ...props,
    }),
  )
}

const rows = (html: string) => html.match(/<a\b[^>]*>/gu) ?? []

describe('GuestLanguageSwitcher: the locale-set matrix', () => {
  it('shows no chip and no sheet for a portal with one language', () => {
    expect(render({ locales: ['en'] })).toBe('')
    expect(render({ locales: ['bg'], selectedLocale: 'bg', copy: bgV2.copy })).toBe('')
    expect(render({ locales: [] })).toBe('')
  })

  it.each([2, 4, 6])(
    'shows a chip and a sheet row per language for %i languages',
    (n) => {
      const locales = GUEST_LOCALES.slice(0, n)
      const html = render({ locales })
      expect(html.match(/<button\b[^>]*aria-haspopup="dialog"/gu)).toHaveLength(1)
      expect(html).toContain('<dialog')
      expect(rows(html)).toHaveLength(n)
      for (const locale of locales) expect(html).toContain(`hrefLang="${locale}"`)
    },
  )

  it('gives a manager preview, which has no public token, no switcher', () => {
    expect(render({ token: undefined })).toBe('')
  })
})

describe('GuestLanguageSwitcher: the chip', () => {
  it.each([
    ['en', 'EN'],
    ['es', 'ES'],
    ['it', 'IT'],
    ['fr', 'FR'],
    ['de', 'DE'],
    ['bg', 'БГ'],
  ] as const)('reads %s as %s', (locale: GuestLocale, code) => {
    const html = render({
      locales: ['en', locale === 'en' ? 'bg' : locale],
      selectedLocale: locale,
    })
    expect(html).toMatch(new RegExp(`<span[^>]*>${code}</span>`, 'u'))
  })

  it('is a closed disclosure of a dialog, named by its code and the current language', () => {
    const html = render()
    const chip = html.match(/<button\b[^>]*aria-haspopup="dialog"[^>]*>/u)?.[0] ?? ''
    expect(chip).toContain('aria-expanded="false"')
    expect(chip).toContain('aria-label="EN, Language: English"')
    expect(chip).toContain('type="button"')
  })

  it('draws its globe and chevron as decoration', () => {
    const chip = render().match(/<button\b[\s\S]*?<\/button>/u)?.[0] ?? ''
    expect(chip.match(/<svg\b[^>]*aria-hidden="true"/gu)).toHaveLength(2)
  })
})

describe('GuestLanguageSwitcher: the sheet', () => {
  const html = render({
    locales: ['en', 'bg', 'es', 'de'],
    accessArtifactId: 'art_1',
  })

  it('is a native dialog named by its title', () => {
    expect(html).toMatch(/<dialog\b[^>]*aria-labelledby="([^"]+)"/u)
    const id = html.match(/<dialog\b[^>]*aria-labelledby="([^"]+)"/u)?.[1] ?? ''
    expect(html).toMatch(new RegExp(`<h2 id="${id}"[^>]*>Language</h2>`, 'u'))
  })

  it('has a close button with a word for it', () => {
    expect(html).toMatch(/<button\b[^>]*aria-label="Close"/u)
  })

  it('links each row to the portal in that language and keeps the channel marker', () => {
    expect(html).toContain('href="/p/tok_abc?locale=bg&amp;accessArtifact=art_1"')
    expect(html).toContain('href="/p/tok_abc?locale=de&amp;accessArtifact=art_1"')
  })

  it('marks the current row and says so in words too', () => {
    expect(rows(html).filter((tag) => tag.includes('aria-current="page"'))).toHaveLength(
      1,
    )
    expect(html).toMatch(/aria-current="page"[\s\S]*?Selected/u)
  })

  it('writes each language’s own name in its own language', () => {
    for (const [locale, name] of [
      ['en', 'English'],
      ['bg', 'Български'],
      ['es', 'Español'],
      ['de', 'Deutsch'],
    ] as const) {
      expect(html).toContain(
        `<span lang="${locale}" class="ih-sheet__name">${name}</span>`,
      )
    }
  })

  it('names the others in the page’s language underneath', () => {
    expect(html).toContain('>Bulgarian</span>')
    expect(html).toContain('>Spanish</span>')
    expect(html).toContain('>German</span>')
    expect(html).not.toMatch(/>English<\/span>\s*<span class="ih-sheet__aside"/u)
  })

  it('explains when the page opens in the phone’s language', () => {
    expect(html).toContain('This page opens in your phone’s language when it has it.')
  })
})

describe('InertLanguageChip (the admin preview)', () => {
  const inert = (locale: GuestLocale = 'en') =>
    renderToStaticMarkup(
      createElement(InertLanguageChip, {
        selectedLocale: locale,
        copy: locale === 'bg' ? bgV2.copy : enV2.copy,
      }),
    )

  it('draws the chip a guest sees, with its code and its name', () => {
    const html = inert()
    expect(html).toContain('ih-chip')
    expect(html).toContain('>EN<')
    expect(html).toContain('aria-label="EN, Language: English"')
    expect(inert('bg')).toContain('>БГ<')
  })

  it('opens nothing: no button, no sheet, no dialog', () => {
    const html = inert()
    expect(html).not.toContain('<button')
    expect(html).not.toContain('<dialog')
    expect(html).not.toContain('aria-haspopup')
  })
})
