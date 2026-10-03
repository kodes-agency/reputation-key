// Region states (UI consistency scan: COLL-08, SURF-08, COLL-15, SURF-10, ACT-07).
//
// "Nothing here" and "this region failed" were drawn about twenty-five ways: a
// dashed box per file, with its own padding, its own icon or none, its own
// "Retry", "Try again" or "Check again", and sometimes no recovery at all.
// EmptyState (size, tone, description, action) and RegionError ("Try again")
// are the one implementation. These checks read the sources, so a new panel that
// re-spells the dashed box, or a new "Retry" button, fails here with the file
// named instead of drifting back.

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

const FILES = SOURCES.flatMap((source) => walk(join(ROOT, source))).map((path) => ({
  path: relative(ROOT, path),
  text: readFileSync(path, 'utf8'),
}))

/**
 * The files that may say `border-dashed`, each for a job that is not a message
 * about an empty or failed region. Everything else uses EmptyState.
 */
const DASHED_ALLOWED: Readonly<Record<string, string>> = {
  'src/components/ui/empty-state.tsx': 'the primitive itself',
  'src/components/ui/chart.tsx': 'a dashed line style in a chart legend',
  'src/components/features/portal/portal-analytics/portal-results-series-chart.tsx':
    'a chart gridline',
  'src/components/inbox/note-message.tsx': 'the dashed edge that marks a private note',
  'src/components/inbox/composer-mode-row.tsx': 'the private-note dock cue',
  'src/components/inbox/reply-composer.tsx': 'the private-note dock cue',
  'src/components/forms/image-upload-field/drop-zone.tsx': 'a file drop target',
  'src/components/features/portal/link-tree/linktree-icon-picker.tsx':
    'an upload tile, not a message',
  'src/components/features/portal/link-tree/link-add-form.tsx':
    'the slot a new link is typed into, a form and not a message',
  'src/components/features/property/property-lifecycle-card.tsx':
    'a recovery-details callout (tones: SURF-05)',
  'src/components/features/portal/property-look/property-look-photo-dialog.tsx':
    'the frame a photograph will fill',
  'src/components/features/property/settings/property-setup-strip.tsx':
    'a step chip that is not yet done',
  'src/components/features/settings/organization-ai-overview-page.tsx':
    'a status pill for "off"',
}

/** A dashed edge, as the utility or as an arbitrary property. */
const DASHED = /border-dashed|\[border-style:\s*dashed\]/u

describe('dashed panels', () => {
  it('are EmptyState, outside the few places a dashed edge means something else', () => {
    const offenders = FILES.filter(
      (file) => DASHED.test(file.text) && !(file.path in DASHED_ALLOWED),
    ).map((file) => file.path)

    expect(offenders).toEqual([])
  })

  it('are not allowed for a file that no longer draws one', () => {
    const stale = Object.keys(DASHED_ALLOWED).filter(
      (path) => !FILES.some((file) => file.path === path && DASHED.test(file.text)),
    )

    expect(stale).toEqual([])
  })

  it('catches the arbitrary-property spelling of the same edge', () => {
    // Spelled in pieces: Tailwind scans test files, and a whole class here would
    // ship its rule in the stylesheet every page loads.
    const arbitrary = ['[border-style', 'dashed]'].join(':')
    const utility = ['border', 'dashed'].join('-')

    expect(DASHED.test(`rounded-lg ${arbitrary}`)).toBe(true)
    expect(DASHED.test(`rounded-lg ${utility}`)).toBe(true)
    expect(DASHED.test('rounded-lg border')).toBe(false)
  })
})

/**
 * The files that may still say "Retry", each for a job that is not the recovery
 * from a region that failed to load. Everything else says "Try again".
 */
const RETRY_ALLOWED: Readonly<Record<string, string>> = {
  'src/components/inbox/reply-composer-footer.tsx':
    '"Retry save" saves the person’s own draft again: an action, not a read',
  'src/components/features/integration/google-import-manager/google-import-progress-items.tsx':
    '"Retry this property" runs one failed import step again: an action, not a read',
  'src/components/features/property/google-performance-section.tsx':
    '"Retry in 30s" counts down a Google rate limit before Refresh comes back',
}

/** The source without its comments, which are free to quote the wrong labels. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|\s)\/\/.*$/gmu, '$1')
}

/**
 * A wrong label wherever a person could read it: JSX text on a line of its own,
 * inside an expression (`{busy ? 'Retrying…' : 'Retry'}`), or in a string prop.
 */
const WRONG_LABEL =
  /\b(Retry|Retrying|Check again)\b|^\s*Please try again\s*$|(['"`])Please try again\2/mu

describe('the recovery from a failed region', () => {
  it('reads "Try again", never "Retry" or "Check again"', () => {
    const offenders = FILES.filter(
      (file) => WRONG_LABEL.test(code(file.text)) && !(file.path in RETRY_ALLOWED),
    ).map((file) => file.path)

    expect(offenders).toEqual([])
  })

  it('does not excuse a file that no longer says "Retry"', () => {
    const stale = Object.keys(RETRY_ALLOWED).filter(
      (path) =>
        !FILES.some((file) => file.path === path && /\bRetry\b/u.test(code(file.text))),
    )

    expect(stale).toEqual([])
  })

  it('catches the labels the old line-only check missed', () => {
    expect(WRONG_LABEL.test(code("{busy ? 'Retrying…' : 'Retry'}"))).toBe(true)
    expect(WRONG_LABEL.test(code('<Button label="Retry" />'))).toBe(true)
    expect(WRONG_LABEL.test(code('  Check again\n'))).toBe(true)
    expect(WRONG_LABEL.test(code('  Please try again\n'))).toBe(true)
    // A sentence that asks the reader to try again is copy, not a button label.
    expect(WRONG_LABEL.test(code('<p>Could not connect. Please try again.</p>'))).toBe(
      false,
    )
    expect(WRONG_LABEL.test(code('// Never "Retry" here'))).toBe(false)
    expect(WRONG_LABEL.test(code('/* a Retry button */'))).toBe(false)
    expect(WRONG_LABEL.test(code('<RetryButton onRetry={retry} />'))).toBe(false)
  })
})
