// One header and one trail (UI consistency scan: FRAME-08, FRAME-09, NAV-10, ACT-12).
//
// A page's breadcrumbs were typed out in twenty files, and the Property crumb was a link
// on some pages and plain text on others; the line under a title was a count, the
// Property, a purpose sentence or a middle-dot meta line; and a "Back to ..." link sat
// above a trail that already led there. `trailCrumbs` is where a trail is spelled,
// `PageHeader`'s `meta` holds what a page's state is, and `description` is help text.
// These checks read the sources, so a hand-typed trail, a dynamic description or a
// second back link fails here with the file named instead of drifting back.
import { describe, expect, it } from 'vitest'
import { readUiSources } from '#/shared/testing/source-tree'

const FILES = readUiSources({ includeTs: true })

type SourceFile = (typeof FILES)[number]

const offendersOf = (
  matches: (file: SourceFile) => boolean,
  allowed: Readonly<Record<string, string>> = {},
) => FILES.filter((file) => matches(file) && !(file.path in allowed)).map((f) => f.path)

/**
 * Every `<PageHeader ... />` element's own props, found by counting braces to its
 * closing `/>`. What is inside a prop's braces is dropped (`actions={...}` holds other
 * elements with props of their own), so `description={` here is the header's.
 */
function pageHeaderProps(text: string): readonly string[] {
  const found: string[] = []
  let from = text.indexOf('<PageHeader')
  while (from !== -1) {
    let depth = 0
    let end = from
    let own = ''
    for (; end < text.length; end++) {
      const char = text[end]
      if (depth === 0 && text.startsWith('/>', end)) break
      if (char === '{') depth++
      if (depth === 0 || char === '{' || char === '}') own += char
      if (char === '}') depth--
    }
    found.push(own)
    from = text.indexOf('<PageHeader', end)
  }
  return found
}

describe('pageHeaderProps', () => {
  it('reads each header up to its closing tag, through braces that hold a `>`', () => {
    const text =
      '<PageHeader title="A" actions={<Dialog description={x} onClick={() => go()} />} />' +
      '<PageHeader title="B" description="C" />'

    expect(pageHeaderProps(text)).toHaveLength(2)
    expect(pageHeaderProps(text)[0]).toContain('actions={')
    expect(pageHeaderProps(text)[0]).not.toContain('description')
    expect(pageHeaderProps(text)[1]).toContain('description="C"')
  })
})

describe('a trail is trailCrumbs', () => {
  const TRAIL_PLACES = /label:\s*['"`](Properties|Settings|Portals|Goals)['"`],\s*to:/u
  const TRAIL_ALLOWED: Readonly<Record<string, string>> = {
    'src/components/layout/page-identity.ts': 'the one place a trail is spelled',
    'src/components/layout/nav-labels.ts': 'the names the sidebar and the trail share',
  }

  it('is not a hand-typed crumb for a place the sidebar names', () => {
    expect(offendersOf((file) => TRAIL_PLACES.test(file.text), TRAIL_ALLOWED)).toEqual([])
  })

  it('catches a hand-typed crumb', () => {
    expect(TRAIL_PLACES.test("{ label: 'Properties', to: '/properties' }")).toBe(true)
    expect(TRAIL_PLACES.test('{ label: NAV_LABEL.portals }')).toBe(false)
    // A row of the notification settings is not a crumb.
    expect(TRAIL_PLACES.test("{ label: 'Goals', description: 'Targets' }")).toBe(false)
  })

  it('is passed to the header as a call or a value, never an array of crumbs', () => {
    const literalTrail = (file: SourceFile) =>
      pageHeaderProps(file.text).some((props) => /breadcrumbs=\{\s*\[/u.test(props))

    expect(offendersOf(literalTrail)).toEqual([])
  })
})

describe('a header slot has one job', () => {
  /**
   * `description` is a sentence of purpose, written out. A count, a name or a status is
   * `meta`; the two pages that print a dynamic sentence say why.
   */
  const DESCRIPTION_ALLOWED: Readonly<Record<string, string>> = {
    'src/components/features/portal/property-look/property-look-page.tsx':
      'a sentence of purpose that names the Property whose look it is',
    'src/routes/_authenticated/properties/$propertyId/goals/$goalId.tsx':
      'the goal’s own description, in the words the person wrote',
  }
  const dynamicDescription = (file: SourceFile) =>
    pageHeaderProps(file.text).some((props) => /\bdescription=\{/u.test(props))

  it('keeps a count, a name or a status out of the description', () => {
    expect(offendersOf(dynamicDescription, DESCRIPTION_ALLOWED)).toEqual([])
  })

  it('lists no file that no longer prints one', () => {
    const stale = Object.keys(DESCRIPTION_ALLOWED).filter(
      (path) => !FILES.some((file) => file.path === path && dynamicDescription(file)),
    )
    expect(stale).toEqual([])
  })
})

describe('the way up is the trail', () => {
  it('has no `backTo` link above a breadcrumb', () => {
    expect(offendersOf((file) => /\bbackTo(=\{|\?:)/u.test(file.text))).toEqual([])
  })
})

describe('the way back is BackLink or BackButton', () => {
  const ARROW = /import\s*\{[^}]*\bArrowLeft\b[^}]*\}\s*from\s*['"]lucide-react['"]/u
  const ARROW_ALLOWED: Readonly<Record<string, string>> = {
    'src/components/ui/back-link.tsx': 'the primitive itself',
    'src/components/ui/back-icon-button.tsx':
      'the arrow alone, which brings the tooltip with it',
    'src/components/layout/settings-sidebar.tsx':
      'a row of the settings sidebar, which is a menu item and not a Button',
  }
  const importsArrow = (file: SourceFile) => ARROW.test(file.text)

  it('draws no back arrow of its own', () => {
    expect(offendersOf(importsArrow, ARROW_ALLOWED)).toEqual([])
  })

  it('lists no file that no longer draws one', () => {
    const stale = Object.keys(ARROW_ALLOWED).filter(
      (path) => !FILES.some((file) => file.path === path && importsArrow(file)),
    )
    expect(stale).toEqual([])
  })
})
