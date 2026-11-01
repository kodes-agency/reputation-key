// The Monthly portal goal shares no module of the Google rating goal, no word of
// it and no line of it, and writes no link ink of its own (ADR 0068, "The two
// goals stay apart", amended 2026-10-19). It may draw with the neutral
// `goal-*` design parts, which `goal-shared-sources.test.ts` holds to the same
// rule from the other side. These read every Portal goal source (its
// components, its route modules, and its pages once they exist) with no
// exemption, and fail with the file named. The three lines the owner approved
// (P-8) are spelled in `portal-goal-copy.ts` only, as approved.
import { describe, expect, it } from 'vitest'
import { importedModules, writtenTexts } from '#/shared/testing/source-texts'
import { readUiSources, type SourceFile } from '#/shared/testing/source-tree'
import {
  HOW_TO_ASK_LINE,
  PLAN_POLICY_LINE,
  UNASKED_REVIEWS_LINE,
} from './rating-goal-copy'
import {
  PORTAL_ASK_EVERY_GUEST_LINE,
  PORTAL_NO_SCAN_HINT,
  PORTAL_SPOT_NOT_PERSON_LINE,
} from './portal-goal-copy'

const GOALS_ROUTE = 'src/routes/_authenticated/properties/$propertyId/goals/'
const COPY_FILE = 'src/components/goals/portal-goal-copy.ts'
/** A Portal's Results line, read beside the Portal's own route (PG-16). */
const RESULTS_LINE_HOST =
  'src/routes/_authenticated/properties/$propertyId/portals/-portal-goal-line.tsx'

/** A Portal goal source: its components, its route modules and its pages. */
function isPortalGoalSource(path: string): boolean {
  if (/^src\/components\/goals\/portal-goal-[^/]+\.tsx?$/u.test(path)) return true
  if (path === RESULTS_LINE_HOST) return true
  if (!path.startsWith(GOALS_ROUTE)) return false
  const name = path.slice(GOALS_ROUTE.length)
  // `$goalId.tsx` is a portal goal's own page (PG-21).
  return /^(-portal-goal-[^/]+\.tsx?|portals\.tsx|portal-results\.tsx|\$goalId\.tsx)$/u.test(
    name,
  )
}

const ALL_SOURCES = readUiSources({ includeTs: true })
const SOURCES = ALL_SOURCES.filter((file) => isPortalGoalSource(file.path))

/** The files among `files` for which `offends` holds. */
const offenders = (
  files: readonly SourceFile[],
  offends: (file: SourceFile) => boolean,
): string[] => files.filter(offends).map(({ path }) => path)

describe('the Monthly portal goal sources', () => {
  it('finds the sources it is meant to read', () => {
    const paths = SOURCES.map(({ path }) => path)

    expect(paths).toContain(COPY_FILE)
    expect(paths).toContain('src/components/goals/portal-goal-section.tsx')
    expect(paths).toContain(`${GOALS_ROUTE}-portal-goal-queries.ts`)
    expect(paths).toContain(RESULTS_LINE_HOST)
    expect(paths).toContain(`${GOALS_ROUTE}-portal-goal-overview.tsx`)
    expect(paths).toContain(`${GOALS_ROUTE}$goalId.tsx`)
    // The page's questions and ruler, and the results list that replaced the matrix.
    for (const name of [
      'portal-goal-bands.tsx',
      'portal-goal-bands-view.ts',
      'portal-goal-ruler-view.ts',
      'portal-goal-results-list.tsx',
      'portal-goal-results-list-view.ts',
    ]) {
      expect(paths).toContain(`src/components/goals/${name}`)
    }
  })

  it('never imports the Google rating goal', () => {
    expect(
      offenders(SOURCES, (file) =>
        importedModules(file).some((module) => /rating-goal/u.test(module)),
      ),
    ).toEqual([])
  })

  it('never says review, Google or plan', () => {
    expect(
      offenders(SOURCES, (file) =>
        writtenTexts(file).some((text) => /\b(review|Google|plan)\b/iu.test(text)),
      ),
    ).toEqual([])
  })

  it('writes no link ink: the headline’s target gets it through GoalHeadline', () => {
    // The link ink is for links (InlineLink, a link Button) and for the one
    // figure a goal leads with, which the shared headline owns
    // (`goal-shared-sources.test.ts`). No Portal figure takes it by a class
    // of its own.
    expect(
      offenders(SOURCES, (file) =>
        writtenTexts(file).some((text) => /\btext-link\b/u.test(text)),
      ),
    ).toEqual([])
  })

  it('never sorts or ranks the Portals’ counts: they stay in the read’s name order (P-1)', () => {
    // The files that say what each Portal brought in: the page's band, its list, the
    // card's list, and the words for both. A sort here would crown a Portal.
    const counting = [
      'portal-goal-bands.tsx',
      'portal-goal-bands-view.ts',
      'portal-goal-from-portals.tsx',
      'portal-goal-page-view.ts',
      'portal-goal-portal-counts.tsx',
      'portal-goal-running-view.ts',
    ].map((name) => `src/components/goals/${name}`)
    const files = SOURCES.filter(({ path }) => counting.includes(path))

    expect(files.map(({ path }) => path).sort()).toEqual([...counting].sort())
    expect(
      offenders(files, (file) =>
        /\.(sort|toSorted)\(|\b(rank|ranking|leaderboard)\b/iu.test(file.text),
      ),
    ).toEqual([])
  })

  it('uses none of the Google lines', () => {
    const googleLines = [
      PLAN_POLICY_LINE,
      HOW_TO_ASK_LINE.lead,
      HOW_TO_ASK_LINE.text,
      UNASKED_REVIEWS_LINE,
    ]
    expect(
      offenders(
        SOURCES,
        (file) =>
          /\b(PLAN_POLICY_LINE|HOW_TO_ASK_LINE|UNASKED_REVIEWS_LINE)\b/u.test(
            file.text,
          ) || googleLines.some((line) => file.text.includes(line)),
      ),
    ).toEqual([])
  })

  it('spells the approved lines once', () => {
    expect(PORTAL_ASK_EVERY_GUEST_LINE).toBe(
      'Ask every guest, not only happy ones. Low and high ratings count the same.',
    )
    expect(PORTAL_NO_SCAN_HINT).toBe('Is it where guests can see it?')
    expect(PORTAL_SPOT_NOT_PERSON_LINE).toBe(
      'Portal goals are about the spot, not the person who works there.',
    )
    for (const line of [
      PORTAL_ASK_EVERY_GUEST_LINE,
      PORTAL_NO_SCAN_HINT,
      PORTAL_SPOT_NOT_PERSON_LINE,
    ]) {
      expect(offenders(ALL_SOURCES, (file) => file.text.includes(line))).toEqual([
        COPY_FILE,
      ])
    }
  })
})
