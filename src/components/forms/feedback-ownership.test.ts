// Who reports a failure (UI consistency scan: SURF-04, FORM-06).
//
// One rule per operation type. A form submit reports through FormErrorBanner,
// directly above that form's actions, and does not also toast; a dialog's submit
// or confirmation is such a form (it stays open and shows the refusal itself). A
// row or immediate action (a switch, a menu item, a download) reports through a
// toast, `errorMessage` on its useActionMutation, and does not also print a banner. An autosaved form has no
// actions to sit a banner above: the editor header's save status reports its
// failure, so it renders no banner either. These checks read the
// sources, so a file that does both, a hand-built red paragraph, a toast that
// echoes an error's own text, or a success that says "successfully" fails here
// with the file named instead of drifting back.

import { describe, expect, it } from 'vitest'
import { readUiSources } from '#/shared/testing/source-tree'

const FILES = readUiSources({ includeTs: true })

const offendersOf = (
  matches: (file: { path: string; text: string }) => boolean,
  allowed: Readonly<Record<string, string>> = {},
) => FILES.filter((file) => matches(file) && !(file.path in allowed)).map((f) => f.path)

const staleIn = (
  matches: (file: { path: string; text: string }) => boolean,
  allowed: Readonly<Record<string, string>>,
) =>
  Object.keys(allowed).filter(
    (path) => !FILES.some((file) => file.path === path && matches(file)),
  )

const RENDERS_BANNER = /<(?:Form|Dialog)ErrorBanner\b/u
/** `toast.error(…)` or the hook's `errorMessage: …` option (not a prop's type). */
const REPORTS_BY_TOAST =
  /toast\.error\(|\berrorMessage:\s*(?:actionErrorMessage|actionFailureMessage\b|['"`(]|\w+Message\b)/u

describe('a failure has one reporter', () => {
  const both = (file: { text: string }) =>
    RENDERS_BANNER.test(file.text) && REPORTS_BY_TOAST.test(file.text)
  /** Files that hold a form and, separately, a command that is not that form's. */
  const BOTH_ALLOWED: Readonly<Record<string, string>> = {}

  it('is a banner for a form submit or a toast for an action, never both in one file', () => {
    expect(offendersOf(both, BOTH_ALLOWED)).toEqual([])
  })

  it('lists no file that no longer does both', () => {
    expect(staleIn(both, BOTH_ALLOWED)).toEqual([])
  })
})

describe('an autosaved form', () => {
  /** The portal editor's forms save through the coordinator as they are typed. */
  const autosaves = (file: { text: string }) =>
    /\busePortalFormAutosave\(/u.test(file.text)
  const bannersAndAutosaves = (file: { text: string }) =>
    autosaves(file) && RENDERS_BANNER.test(file.text)

  it('leaves its failure to the editor header and renders no FormErrorBanner', () => {
    expect(offendersOf(bannersAndAutosaves)).toEqual([])
  })

  it('sees the forms that autosave, so the rule cannot pass for lack of matches', () => {
    expect(offendersOf(autosaves).length).toBeGreaterThan(0)
  })

  it('catches the spelling that double-reported a failed write', () => {
    expect(
      bannersAndAutosaves({
        text: 'usePortalFormAutosave(`override-${locale}`, defaults) <FormErrorBanner error={action.error} />',
      }),
    ).toBe(true)
  })
})

/**
 * Hand-built red paragraphs. The words an action failed in are a banner or a
 * toast; a bare `<p role="alert">` in the destructive ink is a third look.
 */
const RED_ALERT_PARAGRAPH =
  /<p\b(?=[^>]*role="alert")(?=[^>]*\btext-(?:destructive|negative)\b)[^>]*>/u

const RED_PARAGRAPH_ALLOWED: Readonly<Record<string, string>> = {
  'src/components/features/guest/public-portal/guest-private-feedback-form.tsx':
    'the guest renderer, out of scope',
  'src/components/features/guest/public-portal/guest-rating-form.tsx':
    'the guest renderer, out of scope',
  'src/components/features/portal/portal-share/portal-code-block.tsx':
    'the copy fallback: it sits beside the address the person can select instead',
  'src/components/features/portal/portal-share/portal-link-reveal.tsx':
    'the copy fallback: it sits beside the address the person can select instead',
  'src/components/features/portal/portal-new/portal-new-start-from-field.tsx':
    'a field-level error, not an action failure',
  'src/components/features/portal/property-look/property-look-media-actions.tsx':
    'a removal that failed, beside the Remove button',
  'src/components/features/portal/property-look/property-look-batch-dialog.tsx':
    'the stop reason of a batch publish, part of its result readout',
  'src/components/inbox/inbox-detail-regions.tsx':
    'a region that failed to load (region states own it)',
}

describe('red paragraphs', () => {
  const draws = (file: { text: string }) => RED_ALERT_PARAGRAPH.test(file.text)

  it('are a FormErrorBanner or a toast, outside the few places that mean something else', () => {
    expect(offendersOf(draws, RED_PARAGRAPH_ALLOWED)).toEqual([])
  })

  it('are not allowed for a file that no longer draws one', () => {
    expect(staleIn(draws, RED_PARAGRAPH_ALLOWED)).toEqual([])
  })

  it('catches the spelling the scan found', () => {
    expect(
      RED_ALERT_PARAGRAPH.test('<p role="alert" className="text-sm text-destructive">'),
    ).toBe(true)
    expect(
      RED_ALERT_PARAGRAPH.test('<p className="text-sm text-negative" role="alert">'),
    ).toBe(true)
    expect(RED_ALERT_PARAGRAPH.test('<p role="status" className="text-sm">')).toBe(false)
  })
})

describe('toast wording', () => {
  it('never shows the text of an error the person did not write', () => {
    const echoes = (file: { text: string }) =>
      /toast\.error\(\s*(?:err|error|e|cause)\b(?:\.message|\s*instanceof)/u.test(
        file.text,
      )

    expect(offendersOf(echoes)).toEqual([])
  })

  it('does not say "successfully"', () => {
    const verbose = (file: { text: string }) =>
      /(?:successMessage:|toast\.success\()\s*\n?\s*['"`][^'"`]*successfully/u.test(
        file.text,
      )

    expect(offendersOf(verbose)).toEqual([])
  })

  it('names a failed action in one voice: "Couldn’t …." (an apostrophe, a full stop)', () => {
    const sentences = FILES.flatMap((file) =>
      [
        ...file.text.matchAll(
          /actionFailureMessage\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/gu,
        ),
      ].map((match) => ({
        path: file.path,
        sentence: match[1] ?? match[2] ?? match[3] ?? '',
      })),
    )

    expect(sentences.length).toBeGreaterThan(0)
    expect(
      sentences.filter(({ sentence }) => !/^Couldn't .+\.$/u.test(sentence)),
    ).toEqual([])
  })
})
