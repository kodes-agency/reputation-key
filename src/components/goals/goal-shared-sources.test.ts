// The goal design parts every goal shares (ADR 0068, amended 2026-10-19: one goal
// design system) stay neutral. A shared part knows how a goal looks, never which
// goal it is: it imports nothing of the Google rating goal, the Monthly portal
// goal or a server context, and it says no product word, so a goal puts its own
// words in and the other goal's words can never come out. These read every
// shared part with no exemption and fail with the file named.
import { describe, expect, it } from 'vitest'
import { importedModules, writtenTexts } from '#/shared/testing/source-texts'
import { readUiSources, type SourceFile } from '#/shared/testing/source-tree'

/**
 * The shared parts, by file. Listed, not matched by `goal-*`: that name also
 * holds the Goals page's own modules (`goal-live-line.tsx`, the results matrix)
 * which speak of portals and months on purpose. A slice that cuts a new part
 * adds its file here.
 */
const SHARED_PARTS = [
  'goal-card-frame.tsx',
  'goal-check-in.tsx',
  'goal-headline.tsx',
  'goal-meter.tsx',
  'goal-pace-status.ts',
  'goal-setup-parts.tsx',
  'goal-sheet-frame.tsx',
] as const

/** The only shared parts that may write the link ink: it is the colour of the one figure a goal leads with. */
const LINK_INK_PARTS: readonly string[] = ['goal-headline.tsx', 'goal-setup-parts.tsx']

const PARTS_DIR = 'src/components/goals/'

const SOURCES = readUiSources({ includeTs: true }).filter((file) =>
  SHARED_PARTS.some((name) => file.path === `${PARTS_DIR}${name}`),
)

/** The files among `files` for which `offends` holds. */
const offenders = (
  files: readonly SourceFile[],
  offends: (file: SourceFile) => boolean,
): string[] => files.filter(offends).map(({ path }) => path)

describe('the shared goal design parts', () => {
  it('finds the parts it is meant to read', () => {
    expect(SOURCES.map(({ path }) => path).sort()).toEqual(
      SHARED_PARTS.map((name) => `${PARTS_DIR}${name}`).sort(),
    )
  })

  it('reads the modules a part imports, or the next test would pass on nothing', () => {
    // A control: a helper that found no import would let every part through.
    const frame = SOURCES.find(({ path }) => path === `${PARTS_DIR}goal-card-frame.tsx`)

    expect(frame && importedModules(frame)).toContain('#/components/ui/card')
  })

  it('imports neither goal nor a server context', () => {
    expect(
      offenders(SOURCES, (file) =>
        importedModules(file).some((module) =>
          /rating-goal|portal-goal|#\/contexts\//u.test(module),
        ),
      ),
    ).toEqual([])
  })

  it('says no product word', () => {
    // A goal brings its words; the part only lays them out.
    const product = /\b(review|Google|plan|portal|private rating|scan|week|month)s?\b/iu
    expect(
      offenders(SOURCES, (file) => writtenTexts(file).some((text) => product.test(text))),
    ).toEqual([])
  })

  it('keeps the link ink for the headline and the recommendation', () => {
    expect(
      offenders(
        SOURCES.filter(
          ({ path }) => !LINK_INK_PARTS.includes(path.slice(PARTS_DIR.length)),
        ),
        (file) => writtenTexts(file).some((text) => /\btext-link\b/u.test(text)),
      ),
    ).toEqual([])
  })

  it('writes the link ink in the headline, where the target wears it', () => {
    const headline = SOURCES.find(({ path }) => path === `${PARTS_DIR}goal-headline.tsx`)

    expect(
      headline && writtenTexts(headline).some((text) => /\btext-link\b/u.test(text)),
    ).toBe(true)
  })
})
