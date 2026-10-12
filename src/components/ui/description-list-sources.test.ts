// One read-only label and value list (UI consistency scan: FORM-12, COLL-23).
//
// A read-only fact was a <dl> in six grids (an 8rem, a 10rem and a stacked label column,
// bordered cells, a flex row), a disabled Input (the Profile email) or a bare paragraph
// (the Property look display name), so a person could not tell what they cannot change
// from what they can. A label and its value is a `DescriptionList`; a figure with a
// caption is a `MetricStrip`. These checks read the sources, so a new hand-built <dl>
// fails here with the file named instead of drifting back.

import { describe, expect, it } from 'vitest'
import { readUiSources } from '#/shared/testing/source-tree'

const FILES = readUiSources({ includeTs: false })

type SourceFile = (typeof FILES)[number]

const HAND_BUILT_LIST = /<dl\b/u
const drawsAList = (file: SourceFile) => HAND_BUILT_LIST.test(file.text)

/**
 * The files that may draw a <dl> themselves, each for a list that is not a label and a
 * value in a settings card or a dialog.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  'src/components/ui/description-list.tsx': 'the primitive itself',
  'src/components/ui/metric-strip.tsx':
    'figures with captions, a different shape: a strip of numbers',
  'src/components/inbox/inbox-shortcuts-dialog.tsx':
    'a list of key hints beside what they do, not a record read from the app',
  'src/components/features/portal/portal-analytics/portal-results-about.tsx':
    'a glossary: a term and its definition, in two columns, not a label and a value',
  'src/components/features/portal/portal-analytics/portal-response-integrity-summary.tsx':
    'three counts with captions inside a report: a MetricStrip candidate owned by the Results surface',
  'src/components/features/portal/portal-analytics/portal-lifetime-reconciliation-summary.tsx':
    'four readings inside a disclosure: a MetricStrip candidate owned by the Results surface',
  'src/components/features/property/property-guest-voice-page.tsx':
    'what is in a figure: counts set against their captions in a disclosure of a report',
  'src/components/features/property/property-reputation-trend-chart.tsx':
    'the readout of a chart: a date and its values',
}

describe('a read-only label and value is a DescriptionList', () => {
  it('is not a hand-built <dl>, outside the places that name their reason', () => {
    const offenders = FILES.filter(
      (file) => drawsAList(file) && !(file.path in ALLOWED),
    ).map((file) => file.path)

    expect(offenders).toEqual([])
  })

  it('lists no file that no longer draws a <dl>', () => {
    const stale = Object.keys(ALLOWED).filter(
      (path) => !FILES.some((file) => file.path === path && drawsAList(file)),
    )

    expect(stale).toEqual([])
  })

  it('catches the spelling the scan found', () => {
    expect(
      HAND_BUILT_LIST.test(
        '<dl className="grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">',
      ),
    ).toBe(true)
  })

  it('is what the settings cards use for a fact they cannot change', () => {
    const users = FILES.filter((file) => /<DescriptionList\b/u.test(file.text)).map(
      (file) => file.path,
    )

    expect(users).toEqual(
      expect.arrayContaining([
        'src/components/features/identity/profile-settings-form.tsx',
        'src/components/features/portal/property-look/property-look-identity-section.tsx',
        'src/components/features/property/settings/property-google-section.tsx',
        'src/components/features/property/settings/property-profile-card.tsx',
        'src/components/features/settings/merchant-ai-data-handling.tsx',
      ]),
    )
  })
})

describe('a read-only value is not a disabled field or a bare paragraph', () => {
  it('has no disabled email Input: the address is a fact, not a field to edit', () => {
    const disabledEmail = (file: SourceFile) =>
      /<Input\b[^>]*type="email"[^>]*\bdisabled\b/u.test(file.text)

    expect(FILES.filter(disabledEmail).map((file) => file.path)).toEqual([])
  })
})
