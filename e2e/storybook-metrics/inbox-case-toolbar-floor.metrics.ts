// The case toolbar at the narrowest pane the desktop gives it, against Storybook
// where Tailwind is compiled. Run with `pnpm test:storybook:metrics`.
//
// Why this file exists. The detail pane is never narrower than 472 px
// (`InboxDetailPane`, `minSize={472}`), and that is exactly what a 1280 px laptop
// with the app sidebar open gets: 424 px inside the toolbar's `lg:px-6`. The
// group (status, owner, priority, escalation) has to fit that, and the only
// member built to give is the status. When the Priority member kept its word and
// chevron from `md` up, a manager with a long-named colleague on the item needed
// about 480 px, the status word was squeezed to its dot, and the `inbox-triage`
// journey could not see `Open` (e2e shard 3/4 on PR #1018). Nothing caught it
// before: every desktop toolbar story is a 720 px box, and the generic pane rules
// exempt `text-overflow: ellipsis` on purpose, so a status cut to a dot is not an
// overflow to them.
//
// What is asserted, for each story at the pane's floor:
//
//   1. the group fits the toolbar's content box, and nothing spills past it;
//   2. the status word prints whole: its label is not cut with an ellipsis;
//   3. the Priority member is the width its pane gives it: the 36 px glyph square
//      for a level with no word to keep, the word without its chevron for Urgent
//      and High;
//   4. the owner gives first: where the row is over-full the owner's name is cut
//      (to exactly the room that is missing), and the status stays whole. The
//      status is the last member to give, and only once the owner is at its
//      floor (the glyph and the chevron); no row below is that full.
//
// And the other way round, so the fix cannot be "compact everywhere": at a wide
// pane (`priority-suggested`, the 720 px box) Priority is still the full control
// with its chevron.
//
// The window stays 1440 px wide, as in the generic gate: the 472 px stories are a
// pane inside it, and `md:` / `lg:` apply as they do on the real page.

import { expect, test } from '@playwright/test'
import { openStory } from './storybook-story'
import { VIEWPORTS } from './story-matrix'

const TOOLBAR = 'inbox-case-toolbar--'
/** `InboxDetailPane`'s `minSize`, and the width of every story below. */
const FLOOR_PANE_PX = 472
/** `min-w-18` on the owner trigger (4.5rem): padding, the glyph, the chevron and two gaps. */
const OWNER_FLOOR_PX = 72
/** The glyph square (`--control-touch` in a compact workspace). */
const SQUARE_PX = 36
/** Wider than this, Priority is the full control (word, chevron, `Suggested`). */
const FULL_CONTROL_MIN_PX = 100
/** The widest Priority member that still keeps only its word (Urgent, 86 px). */
const WORD_MAX_PX = 100
/** Sub-pixel layout slack; a whole pixel of overflow is a real one. */
const SLACK_PX = 0.5

type Member = Readonly<{ name: string; width: number; ellipsised: boolean }>

type ToolbarReport = Readonly<{
  paneWidth: number
  /** How far the members run past the group's own box (it clips nothing). */
  membersPastGroup: number
  /** How far the group's box runs past the toolbar's content box. */
  groupPastContent: number
  members: ReadonlyArray<Member>
}>

/** Runs in the page: reads nothing outside its own body. */
function measureToolbar(): ToolbarReport | null {
  const section = document.querySelector('section[aria-label="Case status"]')
  const group = section?.querySelector(':scope > [role="group"]')
  if (!section || !group) return null
  const style = getComputedStyle(section)
  const box = section.getBoundingClientRect()
  const contentRight = box.right - parseFloat(style.paddingRight)
  const round = (n: number): number => Math.round(n * 10) / 10
  return {
    paneWidth: round(box.width),
    membersPastGroup: round(group.scrollWidth - group.clientWidth),
    groupPastContent: round(group.getBoundingClientRect().right - contentRight),
    members: Array.from(group.children, (member) => {
      const label = member.querySelector('.truncate')
      return {
        name: member.getAttribute('aria-label') ?? (member.textContent ?? '').trim(),
        width: round(member.getBoundingClientRect().width),
        ellipsised: label !== null && label.scrollWidth > label.clientWidth + 0.5,
      }
    }),
  }
}

/** How much of the owner's name the row leaves: all of it, or some of it. */
type OwnerName = 'whole' | 'cut'

type Floor = Readonly<{
  id: string
  /** The Priority member's width, from and to. */
  priority: readonly [number, number]
  owner: OwnerName
}>

const FLOOR_STORIES: ReadonlyArray<Floor> = [
  // Urgent keeps its word; the long name is what gives.
  {
    id: 'priority-long-assignee-472',
    priority: [60, WORD_MAX_PX],
    owner: 'cut',
  },
  {
    id: 'priority-feedback-not-set-472',
    priority: [SQUARE_PX, SQUARE_PX],
    owner: 'whole',
  },
  // High keeps its word; `[Closed ▾]` keeps its chevron.
  {
    id: 'priority-closed-review-suggested-472',
    priority: [60, WORD_MAX_PX],
    owner: 'whole',
  },
  // 32 px short: the owner gives that much, not its whole name.
  {
    id: 'priority-escalated-urgent-472',
    priority: [60, WORD_MAX_PX],
    owner: 'cut',
  },
  // 57 px short, the widest feedback row: the owner gives that much, and
  // `To handle` prints whole.
  {
    id: 'priority-feedback-escalated-urgent-472',
    priority: [60, WORD_MAX_PX],
    owner: 'cut',
  },
]

const memberNamed = (report: ToolbarReport, prefix: string): Member | undefined =>
  report.members.find((member) => member.name.startsWith(prefix))

const inRange = (width: number, [from, to]: readonly [number, number]): boolean =>
  width >= from - SLACK_PX && width <= to + SLACK_PX

function ownerViolations(
  expected: OwnerName,
  owner: Member | undefined,
): ReadonlyArray<string> {
  if (owner === undefined) return ['the group has no owner member']
  const atFloor = inRange(owner.width, [OWNER_FLOOR_PX, OWNER_FLOOR_PX])
  switch (expected) {
    case 'whole':
      return owner.ellipsised ? [`the owner's name is cut at ${owner.width} px`] : []
    case 'cut':
      return owner.ellipsised && !atFloor
        ? []
        : [
            `the owner is ${owner.width} px (${owner.ellipsised ? 'cut' : 'whole'}); the row should cut its name but leave room for the glyph`,
          ]
  }
}

/** The group fits the pane it is in, and the pane is the floor the story claims. */
function fitViolations(report: ToolbarReport): ReadonlyArray<string> {
  const lines: Array<string> = []
  if (report.paneWidth !== FLOOR_PANE_PX) {
    lines.push(`the pane is ${report.paneWidth} px, not the ${FLOOR_PANE_PX} px floor`)
  }
  if (report.membersPastGroup > SLACK_PX || report.groupPastContent > SLACK_PX) {
    lines.push(
      `the members run ${report.membersPastGroup} px past the group, which runs ${report.groupPastContent} px past the toolbar's content`,
    )
  }
  return lines
}

/**
 * The status prints whole. Its word is not asserted: it is the status's copy,
 * which is not this file's.
 */
function statusViolations(status: Member | undefined): ReadonlyArray<string> {
  if (status === undefined) return ['the group has no status member']
  return status.ellipsised ? [`the status "${status.name}" is cut short`] : []
}

function priorityViolations(
  expected: readonly [number, number],
  priority: Member | undefined,
): ReadonlyArray<string> {
  if (priority === undefined) return ['the group has no Priority member']
  return inRange(priority.width, expected)
    ? []
    : [`Priority is ${priority.width} px, expected ${expected[0]}-${expected[1]} px`]
}

function violations(floor: Floor, report: ToolbarReport): ReadonlyArray<string> {
  return [
    ...fitViolations(report),
    ...statusViolations(report.members[0]),
    ...priorityViolations(floor.priority, memberNamed(report, 'Priority')),
    ...ownerViolations(floor.owner, memberNamed(report, 'Assignment')),
  ]
}

test.describe('the case toolbar at the detail pane floor', () => {
  test.use({ viewport: VIEWPORTS[1440] })

  for (const floor of FLOOR_STORIES) {
    test(`${TOOLBAR}${floor.id} fits ${FLOOR_PANE_PX} px`, async ({ page }, testInfo) => {
      await openStory(page, `${TOOLBAR}${floor.id}`)
      const report = await page.evaluate(measureToolbar)
      expect(report, 'the case toolbar is on screen').not.toBeNull()
      if (report === null) return
      const lines = violations(floor, report)
      await testInfo.attach('toolbar-floor.json', {
        body: JSON.stringify({ floor, report, violations: lines }, null, 2),
        contentType: 'application/json',
      })
      expect(lines, `${lines.length} violation(s) in ${floor.id}`).toEqual([])
    })
  }

  test('a wide pane keeps the full Priority control', async ({ page }) => {
    await openStory(page, `${TOOLBAR}priority-suggested`)
    const report = await page.evaluate(measureToolbar)
    const priority = report === null ? undefined : memberNamed(report, 'Priority')
    expect(priority?.width ?? 0, 'Priority at the 720 px pane').toBeGreaterThan(
      FULL_CONTROL_MIN_PX,
    )
    expect(report?.members[0]?.ellipsised, 'the status at the 720 px pane').toBe(false)
  })
})
