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

const PLUS_IMPORT = /import\s*\{[^}]*\bPlus\b[^}]*\}\s*from\s*['"]lucide-react['"]/u

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
})
