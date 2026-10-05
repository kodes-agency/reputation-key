// One save row, one field anatomy (UI consistency scan: FORM-01, FORM-19, ACT-04,
// FORM-05; decisions 4, 5 and 6).
//
// A settings group's Save was placed, aligned and ordered eight ways, its "Cancel" was
// a link to another page, and a field's label, help and "optional" were rebuilt by hand
// in eleven files. `FormActions` is the row a group saves from and `FormFieldFrame` the
// anatomy of a field. These checks read the sources, so a new group that places its own
// Save, a settings Cancel that navigates, or a hand-spelled "(optional)" fails here with
// the file named instead of drifting back.

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const SOURCES = ['src/components', 'src/routes'] as const

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return /\.tsx?$/u.test(entry.name) && !/\.(stories|test)\./u.test(entry.name)
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

const offendersOf = (
  matches: (file: SourceFile) => boolean,
  allowed: Readonly<Record<string, string>> = {},
) => FILES.filter((file) => matches(file) && !(file.path in allowed)).map((f) => f.path)

const staleIn = (
  matches: (file: SourceFile) => boolean,
  allowed: Readonly<Record<string, string>>,
) =>
  Object.keys(allowed).filter(
    (path) => !FILES.some((file) => file.path === path && matches(file)),
  )

describe('a settings group has no Cancel that leaves the page', () => {
  /** A router Link labelled Cancel: it resets nothing and goes somewhere else. */
  const CANCEL_LINK = /<Link\b[^>]*>\s*Cancel\s*<\/Link>/u
  const hasCancelLink = (file: SourceFile) => CANCEL_LINK.test(file.text)

  it('is Reset, which puts the saved values back (a dialog or a bounded task keeps Cancel)', () => {
    expect(offendersOf(hasCancelLink)).toEqual([])
  })

  it('catches the spelling the scan found', () => {
    expect(
      CANCEL_LINK.test(
        '<Button asChild><Link to="/settings/profile">Cancel</Link></Button>',
      ),
    ).toBe(true)
    expect(CANCEL_LINK.test('<Button onClick={onCancel}>Cancel</Button>')).toBe(false)
  })
})

describe('an explicit-save group saves from FormActions', () => {
  const SUBMIT = /<SubmitButton\b/u
  const ROW = /<FormActions\b|<DialogFooter\b/u
  const placesItsOwnSave = (file: SourceFile) =>
    file.path.startsWith('src/components/features/') &&
    SUBMIT.test(file.text) &&
    !ROW.test(file.text)

  /** Forms that are not a settings group: a page of their own, or one step of a task. */
  const SAVE_ALLOWED: Readonly<Record<string, string>> = {
    'src/components/features/guest/public-portal/guest-private-feedback-form.tsx':
      'the guest renderer, out of scope',
    'src/components/features/guest/public-portal/guest-rating-form.tsx':
      'the guest renderer, out of scope',
    'src/components/features/identity/login/login-form.tsx':
      'a sign-in page, one full-width submit',
    'src/components/features/identity/registration/register-form.tsx':
      'a registration page, one full-width submit',
    'src/components/features/identity/reset-password/reset-password-form.tsx':
      'a recovery page, one full-width submit',
    'src/components/features/identity/reset-password/set-new-password-form.tsx':
      'a recovery page, one full-width submit',
    'src/components/features/portal/portal-settings/portal-approved-destination-request-form.tsx':
      'an inline add: one field and its button on a line',
  }

  it('is a FormActions row (or a DialogFooter), not a Save the group places itself', () => {
    expect(offendersOf(placesItsOwnSave, SAVE_ALLOWED)).toEqual([])
  })

  it('lists no file that no longer places its own Save', () => {
    expect(staleIn(placesItsOwnSave, SAVE_ALLOWED)).toEqual([])
  })

  it('sees the groups that use it, so the rule cannot pass for lack of matches', () => {
    expect(
      FILES.filter((file) => /<FormActions\b/u.test(file.text)).length,
    ).toBeGreaterThan(10)
  })

  it('leaves Reset to the row: no group spells a Reset of its own', () => {
    // A group that spells its own "Reset" next to a Save has re-implemented the row.
    const spellsReset = (file: SourceFile) =>
      file.path !== 'src/components/forms/form-actions.tsx' &&
      />\s*Reset\s*<\/Button>/u.test(file.text)

    expect(offendersOf(spellsReset)).toEqual([])
  })
})

describe('a field is drawn by the shared anatomy', () => {
  it('marks an optional field with the Optional marker, not a "(optional)" suffix', () => {
    const SUFFIX = /(?:label=|>)[^<>{}]*\(optional\)/iu
    const hasSuffix = (file: SourceFile) =>
      !file.path.startsWith('src/components/features/guest/') && SUFFIX.test(file.text)
    const SUFFIX_ALLOWED: Readonly<Record<string, string>> = {
      'src/components/inbox/reply-message-actions.tsx':
        'the Inbox inline Reject keeps its compact reason field, whose name its stories pin',
    }

    expect(offendersOf(hasSuffix, SUFFIX_ALLOWED)).toEqual([])
    expect(staleIn(hasSuffix, SUFFIX_ALLOWED)).toEqual([])
  })

  it('does not rebuild a label, a control and its error by hand', () => {
    // FormTextField, FormTextarea and FormNumberField are the field, and
    // FormFieldFrame is the anatomy for a control of another kind.
    const rebuilds = (file: SourceFile) =>
      /<FieldError\b/u.test(file.text) &&
      /<FieldLabel\b/u.test(file.text) &&
      /<(?:Input|Textarea)\b/u.test(file.text) &&
      !file.path.startsWith('src/components/forms/') &&
      !file.path.startsWith('src/components/ui/')
    const REBUILD_ALLOWED: Readonly<Record<string, string>> = {
      'src/components/features/portal/link-tree/linktree-title-form.tsx':
        'the Portal editor’s label-left row, a deliberate layout',
      'src/components/goals/goal-program-revision-dialog.tsx':
        'the metric is a native select (the controls slice), beside the shared target field',
      'src/routes/_authenticated/properties/$propertyId/goals/new.tsx':
        'the metric is a native select (the controls slice), beside the shared fields',
    }

    expect(offendersOf(rebuilds, REBUILD_ALLOWED)).toEqual([])
    expect(staleIn(rebuilds, REBUILD_ALLOWED)).toEqual([])
  })
})
