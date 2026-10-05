// One outline, one scale (UI consistency scan: FORM-10, FRAME-10, FORM-04).
//
// A page had zero, one or two h1s (the Organization page's name beside its header, the
// Inbox's queue label removed from a phone), a settings section's title was a div, and a
// section title came in `font-semibold`, `text-base font-semibold`, `text-sm font-medium`
// and bare `font-medium`, as an h2, an h3 or a div with role="heading". Now a page's h1 is
// drawn by a few components, a settings section is a `CardTitle` with a level or a
// `SectionTitle`, and the two scales are the primitives'. These checks read the sources,
// so a second h1, a section title that is a div or one that sets its own size fails here
// with the file named instead of drifting back.

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const SOURCES = ['src/components', 'src/routes'] as const

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return /\.tsx$/u.test(entry.name) && !/\.(stories|test)\./u.test(entry.name)
      ? [path]
      : []
  })
}

/** The source without its comments, which are free to quote the old spellings. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|\s)\/\/.*$/gmu, '$1')
}

const FILES = SOURCES.flatMap((source) => walk(join(ROOT, source))).map((path) => ({
  path: relative(ROOT, path),
  text: code(readFileSync(path, 'utf8')),
}))

type SourceFile = (typeof FILES)[number]

const pathsOf = (matches: (file: SourceFile) => boolean) =>
  FILES.filter(matches).map((file) => file.path)

describe('a page has one h1, drawn by a few components', () => {
  const H1 = /<h1\b|<CardTitle\b[^>]*\bas="h1"/u
  /** The only components that draw a page's h1, each for the surface it heads. */
  const ALLOWED: Readonly<Record<string, string>> = {
    'src/components/layout/page-header.tsx': 'the page header of every page with one',
    'src/components/layout/auth-layout.tsx':
      'sign in, join and reset: the card is the page',
    'src/components/inbox/inbox-list-header.tsx':
      'the Inbox: a compact surface, heard on a phone and drawn from md',
    'src/components/features/portal/portal-workspace/portal-workspace-header.tsx':
      'the Portal workspace: a compact full-bleed header',
    'src/components/features/guest/public-portal/guest-page-view.tsx':
      'the guest renderer, out of scope',
    'src/components/features/guest/portal-unavailable.tsx':
      'the guest renderer, out of scope',
    'src/components/features/guest/public-portal/immersive/guest-title-block.tsx':
      'the guest renderer, out of scope',
    'src/components/features/guest/public-portal/immersive/__fixtures__/response-page-stand-in.tsx':
      'a guest renderer fixture',
  }
  const draws = (file: SourceFile) => H1.test(file.text)

  it('is not an h1 written in a feature: a page names itself through its header', () => {
    expect(pathsOf((file) => draws(file) && !(file.path in ALLOWED))).toEqual([])
  })

  it('lists no file that no longer draws an h1', () => {
    const stale = Object.keys(ALLOWED).filter(
      (path) => !FILES.some((file) => file.path === path && draws(file)),
    )

    expect(stale).toEqual([])
  })

  it('catches the spelling the scan found: a second h1 beside the page header', () => {
    expect(
      H1.test('<h1 className="text-xl font-semibold display-title">{name}</h1>'),
    ).toBe(true)
    expect(H1.test('<CardTitle as="h1" className="text-2xl">')).toBe(true)
    expect(H1.test('<CardTitle as="h2">')).toBe(false)
  })

  it('keeps the Inbox heading in the page on a phone', () => {
    const header = FILES.find(
      (file) => file.path === 'src/components/inbox/inbox-list-header.tsx',
    )

    expect(header?.text).toMatch(/<h1[^>]*max-md:sr-only/u)
  })
})

describe('a section title is a CardTitle with a level or a SectionTitle', () => {
  /** A CardTitle with no `as`: a div, which an outline cannot list. */
  const BARE_CARD_TITLE = /<CardTitle(?![^>]*\bas=)[\s>]/u
  const BARE_ALLOWED: Readonly<Record<string, string>> = {
    'src/components/features/property/google-performance-chart.tsx':
      'the title wraps its own h2 (an analytics page, h2 at text-lg)',
    'src/components/features/property/google-performance-metrics.tsx':
      'the title wraps its own h2 (an analytics page, h2 at text-lg)',
    'src/components/features/property/google-performance-report.tsx':
      'the title wraps its own h2 (an analytics page, h2 at text-lg)',
  }
  const hasBare = (file: SourceFile) => BARE_CARD_TITLE.test(file.text)

  it('is not a div: every Card title says its level', () => {
    expect(pathsOf((file) => hasBare(file) && !(file.path in BARE_ALLOWED))).toEqual([])
  })

  it('lists no file that no longer has a bare CardTitle', () => {
    expect(
      Object.keys(BARE_ALLOWED).filter(
        (path) => !FILES.some((file) => file.path === path && hasBare(file)),
      ),
    ).toEqual([])
  })

  it('catches both spellings', () => {
    expect(BARE_CARD_TITLE.test('<CardTitle>Quiet hours</CardTitle>')).toBe(true)
    expect(BARE_CARD_TITLE.test('<CardTitle className="text-2xl">Hi</CardTitle>')).toBe(
      true,
    )
    expect(BARE_CARD_TITLE.test('<CardTitle as="h2" className="x">Hi</CardTitle>')).toBe(
      false,
    )
  })

  /** The pages of an account or a Property's settings, where the scale is the primitives'. */
  const FAMILY =
    /^src\/(?:components\/features\/(?:settings|identity|organization|property\/settings)\/|routes\/_authenticated\/settings\/)/u
  const OWN_HEADING = /<h[2-4]\b|\brole="heading"/u
  const FAMILY_ALLOWED: Readonly<Record<string, string>> = {
    'src/components/features/settings/organization-ai-overview-page.tsx':
      'an h2 that only a screen reader reads, naming the table below it',
    'src/components/features/property/settings/property-setup-strip.tsx':
      'the setup strip: a compact progress title, not a section',
  }

  it('is not an h2, h3 or role="heading" with a size of its own in the settings pages', () => {
    const offenders = pathsOf(
      (file) =>
        FAMILY.test(file.path) &&
        OWN_HEADING.test(file.text) &&
        !(file.path in FAMILY_ALLOWED),
    )

    expect(offenders).toEqual([])
  })

  it('lists no settings file that no longer draws a heading of its own', () => {
    expect(
      Object.keys(FAMILY_ALLOWED).filter(
        (path) =>
          !FILES.some((file) => file.path === path && OWN_HEADING.test(file.text)),
      ),
    ).toEqual([])
  })

  it('sees the titles in use, so the rule cannot pass for lack of matches', () => {
    expect(
      pathsOf((file) => FAMILY.test(file.path) && /<SectionTitle\b/u.test(file.text))
        .length,
    ).toBeGreaterThan(3)
    expect(
      pathsOf((file) => FAMILY.test(file.path) && /<CardTitle as="h2"/u.test(file.text))
        .length,
    ).toBeGreaterThan(10)
  })
})
