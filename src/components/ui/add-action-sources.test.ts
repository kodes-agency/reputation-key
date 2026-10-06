// One add button (UI consistency scan: COLL-21, ACT-14, FRAME-12).
//
// A Plus before a label was spelled `<Plus />`, `<Plus data-icon="inline-start" />` and
// `<Plus className="size-4" />` in a dozen Buttons, in two cases and at two heights.
// `AddAction` and `AddActionLink` draw the Plus and the Button; a page's add is one of
// them. These checks read the sources, so a new hand-built add control fails here with
// the file named instead of drifting back.
import { describe, expect, it } from 'vitest'
import { readUiSources } from '#/shared/testing/source-tree'

const FILES = readUiSources()

/** The glyph that says "add": the bare Plus in its spellings, and the folder one of a group. */
const PLUS_IMPORT =
  /import\s*\{[^}]*\b(?:Plus|PlusIcon|CirclePlus|SquarePlus|FolderPlus)\b[^}]*\}\s*from\s*['"]lucide-react['"]/u

const ALLOWED: Readonly<Record<string, string>> = {
  'src/components/ui/add-action.tsx': 'the primitive itself',
  'src/components/features/integration/connect-google-button/connect-google-button.tsx':
    'the Google button draws the glyph for adding an account, as its own primitive',
  'src/components/features/portal/portal-new/portal-new-languages-field.tsx':
    'a chip that toggles a language on, not a button that adds',
  'src/components/features/property/reply-template-editor.tsx':
    'one trigger that is Add template, or Edit when a template is open',
  'src/components/layout/manager-property-switcher.tsx':
    'a menu item of the sidebar’s property menu, not a button',
  'src/components/features/portal/portal-list-page.tsx':
    'New group is the secondary action beside New portal: its folder glyph tells a group from a portal',
  'src/components/inbox/history-event-node.tsx':
    'the glyph of a "created" event in a history line, not a button',
  'src/components/features/portal/portal-group/portal-group-history.tsx':
    'the glyph of a "created" event in a history line, not a button',
  'src/components/features/portal/portal-history/portal-history-glyph.tsx':
    'the glyph of a "created" event in a history line, not a button',
}

const importsPlus = (path: string) =>
  FILES.some((file) => file.path === path && PLUS_IMPORT.test(file.text))

describe('an add control is AddAction', () => {
  it('draws no Plus of its own beside a label', () => {
    const offenders = FILES.filter(
      (file) => PLUS_IMPORT.test(file.text) && !(file.path in ALLOWED),
    ).map((file) => file.path)

    expect(offenders).toEqual([])
  })

  it('lists no file that no longer imports the glyph', () => {
    expect(Object.keys(ALLOWED).filter((path) => !importsPlus(path))).toEqual([])
  })

  it('catches the import', () => {
    expect(PLUS_IMPORT.test("import { ChevronDown, Plus } from 'lucide-react'")).toBe(
      true,
    )
    expect(PLUS_IMPORT.test("import { Plug } from 'lucide-react'")).toBe(false)
  })

  it('catches the other spellings of the glyph', () => {
    for (const name of ['PlusIcon', 'CirclePlus', 'SquarePlus', 'FolderPlus']) {
      expect(PLUS_IMPORT.test(`import { ${name} } from 'lucide-react'`)).toBe(true)
    }
    // A glyph for a thing, not for adding.
    expect(PLUS_IMPORT.test("import { UserPlus } from 'lucide-react'")).toBe(false)
  })
})
