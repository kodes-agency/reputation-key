// The table that sets several goals, as a first request draws it. What a save
// then does to the rows (the pills, the live region, the focus) needs a
// browser and is played in goal-bulk-table.stories.tsx.
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import type { createGoalsForSubjects } from '#/contexts/reporting/server/goal-bulk-create'
import { GoalBulkRows } from './goal-bulk-rows'
import { GoalBulkTable, type GoalBulkTableProps } from './goal-bulk-table'
import { goalBulkSubmission } from './goal-bulk-save'
import { goalBulkRows, goalBulkSubjects } from './goal-bulk-view'
import { goalStartChoice } from './goal-start-view'
import {
  BAR_ID,
  BAR_RATINGS,
  BULK_GROUPS,
  BULK_PORTALS,
  BULK_PROPERTY,
  EARLY_IN_OCTOBER,
  FLOOR_ID,
  FLOOR_RATINGS,
  LATE_IN_OCTOBER,
  LOBBY_ID,
  LOBBY_RATINGS,
  LOBBY_RATINGS_ENDED,
} from './goal-bulk.stories.fixtures'

const neverSaves = (() =>
  Promise.reject(
    new Error('a first request saves nothing'),
  )) as unknown as typeof createGoalsForSubjects

function render(node: ReactNode): string {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(RouterContextProvider, { router, children: node }),
    ),
  )
}

function table(over: Partial<GoalBulkTableProps> = {}): string {
  const now = over.now ?? EARLY_IN_OCTOBER
  return render(
    createElement(GoalBulkTable, {
      createGoalsForSubjectsFn: neverSaves,
      property: BULK_PROPERTY,
      groups: BULK_GROUPS,
      portals: BULK_PORTALS,
      programs: [],
      goalsRead: { failed: false, retrying: false, readAgain: () => undefined },
      start: goalStartChoice(now, BULK_PROPERTY.timezone),
      now,
      onMonthChanged: () => undefined,
      ...over,
    }),
  )
}

/** The markup of the row that names `name`, from its `<tr` to its `</tr>`. */
function rowOf(html: string, name: string): string {
  const row = html.split('<tr').find((part) => part.includes(`>${name}</p>`))
  if (row === undefined) throw new Error(`no row for ${name} in ${html}`)
  return row
}

const fieldIn = (row: string) => row.match(/<input [^>]*>/u)?.[0]

describe('GoalBulkTable', () => {
  it('has one number per Portal and per Portal Group, by name, and none for an archived Portal', () => {
    const html = table()

    expect(html).toContain('Set goals for several portals')
    expect(html).toContain('One number per portal. Each becomes its own goal.')
    expect(
      [...html.matchAll(/<label[^>]*>(Monthly target for [^<]+)</gu)].map((m) => m[1]),
    ).toEqual([
      'Monthly target for Bar QR',
      'Monthly target for First floor (portal group)',
      'Monthly target for Lobby QR',
    ])
    expect(html).not.toContain('Old spa desk')
    expect(rowOf(html, 'First floor')).toContain('>Portal group</p>')
    expect(fieldIn(rowOf(html, 'Bar QR'))).toContain(`id="goal-target-portal-${BAR_ID}"`)
    expect(html).toContain('>Save goals</button>')
  })

  it('names each number for a screen reader and leaves the column header to the eye', () => {
    const row = rowOf(table(), 'First floor')

    expect(row).toMatch(
      new RegExp(
        `<label[^>]*class="[^"]*\\bsr-only\\b[^"]*"[^>]*for="goal-target-portal_group-${FLOOR_ID}"`,
        'u',
      ),
    )
    expect(fieldIn(row)).toContain('type="number"')
    expect(fieldIn(row)).toContain('min="1"')
    // A count is a whole number with no upper bound.
    expect(fieldIn(row)).not.toContain('max=')
    expect(fieldIn(row)).not.toContain('step=')
  })

  // The kind is otherwise only the grey line in the first cell, which a
  // screen reader does not hear with the field.
  it('tells the number of a Portal Group from that of a Portal with the same name', () => {
    const html = table({
      groups: [{ id: FLOOR_ID, name: 'Restaurant' }],
      portals: [{ id: BAR_ID, name: 'Restaurant', publicationState: 'published' }],
    })
    const labelFor = (id: string) =>
      html.match(new RegExp(`<label[^>]*for="${id}"[^>]*>([^<]+)<`, 'u'))?.[1]

    expect(labelFor(`goal-target-portal-${BAR_ID}`)).toBe('Monthly target for Restaurant')
    expect(labelFor(`goal-target-portal_group-${FLOOR_ID}`)).toBe(
      'Monthly target for Restaurant (portal group)',
    )
  })

  it('a subject in a live goal takes no number: its row shows the target and links to that goal', () => {
    const row = rowOf(table({ programs: [LOBBY_RATINGS] }), 'Lobby QR')

    expect(fieldIn(row)).toBeUndefined()
    expect(row).toContain('>400</p>')
    expect(row).toContain('Already has a goal')
    expect(row).toContain(
      'Lobby QR is part of Lobby ratings. Remove it from that goal’s subjects, then start the new goal next month.',
    )
    expect(row).toMatch(
      new RegExp(
        `<a [^>]*href="/properties/${BULK_PROPERTY.id}/goals/${LOBBY_RATINGS.program.id}"[^>]*>Lobby ratings</a>`,
        'u',
      ),
    )
  })

  it('a subject held by an ended goal is shown as occupied until its month ends', () => {
    // On the 11th the goals start in October, which the ended goal still holds.
    const october = rowOf(table({ programs: [LOBBY_RATINGS_ENDED] }), 'Lobby QR')

    expect(fieldIn(october)).toBeUndefined()
    expect(october).toContain('>400</p>')
    expect(october).toContain('Already has a goal')
    expect(october).toContain(
      'Lobby QR has a goal for this measure that ends Oct 31. Start the new goal next month.',
    )

    // On the 21st they start in November, when the Lobby is free again.
    const november = rowOf(
      table({ programs: [LOBBY_RATINGS_ENDED], now: LATE_IN_OCTOBER }),
      'Lobby QR',
    )

    expect(fieldIn(november)).toContain(`id="goal-target-portal-${LOBBY_ID}"`)
    expect(november).not.toContain('Already has a goal')
  })

  it('a goal for another measure does not occupy the row', () => {
    const scans = {
      ...LOBBY_RATINGS,
      assignments: LOBBY_RATINGS.assignments.map((assignment) => ({
        ...assignment,
        metric: 'qualified_scans' as const,
      })),
    }

    expect(fieldIn(rowOf(table({ programs: [scans] }), 'Lobby QR'))).toBeDefined()
  })

  // The usual return visit. A Save button here could only answer "Enter a
  // target for at least one portal", which no row would take.
  it('has no Save button when no row takes a number: it says so and links back to Goals', () => {
    const html = table({ programs: [LOBBY_RATINGS, BAR_RATINGS, FLOOR_RATINGS] })

    expect(html).not.toContain('type="number"')
    expect(html).not.toContain('Save goals')
    expect(html).toContain('Every portal and group has a goal for this measure.')
    expect(html).toMatch(
      new RegExp(
        `<a [^>]*href="/properties/${BULK_PROPERTY.id}/goals"[^>]*>.*Back to goals</a>`,
        'u',
      ),
    )
  })

  it('offers no way back beside the button before anything was saved', () => {
    const html = table({ programs: [LOBBY_RATINGS] })

    expect(html).toContain('>Save goals</button>')
    expect(html).not.toContain('Back to goals')
  })

  it('says so when the Property has fewer than two Portals or groups', () => {
    const html = table({ groups: [], portals: [BULK_PORTALS[0], BULK_PORTALS[2]] })

    expect(html).toContain('This property has one portal')
    expect(html).toContain('Set its goal on the One goal tab.')
    expect(html).not.toContain('<table')
    expect(html).not.toContain('Save goals')
  })

  it('waits for the goals before it draws a row', () => {
    const html = table({ programs: undefined })

    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('Loading portals and goals')
    expect(html).not.toContain('<input')
  })

  it('says the goals could not be read, with Try again, and draws no row', () => {
    const html = table({
      programs: undefined,
      goalsRead: { failed: true, retrying: false, readAgain: () => undefined },
    })

    expect(html).toContain('The goals couldn’t be loaded.')
    expect(html).toContain('Try again')
    expect(html).not.toContain('<input')
  })

  it('keeps the table when a later read of the goals fails', () => {
    const html = table({
      programs: [LOBBY_RATINGS],
      goalsRead: { failed: true, retrying: false, readAgain: () => undefined },
    })

    expect(html).not.toContain('The goals couldn’t be loaded.')
    expect(html).toContain('Monthly target for Bar QR')
  })
})

describe('GoalBulkRows', () => {
  const subjects = goalBulkSubjects(BULK_GROUPS, BULK_PORTALS)
  const lobby = `portal:${LOBBY_ID}`
  const rowsWith = (report: Parameters<typeof goalBulkRows>[0]['report']) =>
    goalBulkRows({
      subjects,
      holds: [],
      report,
      startsThisMonth: true,
      timezone: BULK_PROPERTY.timezone,
      now: EARLY_IN_OCTOBER,
    })

  it('the average measure shows the 1 to 5 message', () => {
    const targets = { [lobby]: 7 }
    const refused = goalBulkSubmission(rowsWith({}), targets, 'portal_rating_average')
    const html = render(
      createElement(GoalBulkRows, {
        propertyId: BULK_PROPERTY.id,
        metric: 'portal_rating_average',
        rows: rowsWith(refused.ok ? {} : refused.report),
        targets,
        onTargetChange: () => undefined,
        rowRef: () => undefined,
      }),
    )
    const row = rowOf(html, 'Lobby QR')

    expect(refused.ok).toBe(false)
    expect(row).toContain('Use a rating target from 1 to 5')
    // The field takes a rating to one decimal place, and names its fault.
    expect(fieldIn(row)).toContain('max="5"')
    expect(fieldIn(row)).toContain('step="0.1"')
    expect(fieldIn(row)).toContain('value="7"')
    expect(fieldIn(row)).toContain('aria-invalid="true"')
    expect(fieldIn(row)).toContain(
      `aria-describedby="goal-target-portal-${LOBBY_ID}-error"`,
    )
    // The other rows are not in question.
    expect(fieldIn(rowOf(html, 'Bar QR'))).not.toContain('aria-invalid="true"')
  })

  it('a row whose Portal is no longer available has no field and says why', () => {
    const html = render(
      createElement(GoalBulkRows, {
        propertyId: BULK_PROPERTY.id,
        metric: 'portal_rating_count',
        rows: rowsWith({ [lobby]: { code: 'invalid_subject' } }),
        targets: { [lobby]: 40 },
        onTargetChange: () => undefined,
        rowRef: () => undefined,
      }),
    )
    const row = rowOf(html, 'Lobby QR')

    expect(fieldIn(row)).toBeUndefined()
    expect(row).toContain('No longer available')
    expect(fieldIn(rowOf(html, 'Bar QR'))).toBeDefined()
  })

  it('a saved row shows the number it was saved with and a link to its goal', () => {
    const html = render(
      createElement(GoalBulkRows, {
        propertyId: BULK_PROPERTY.id,
        metric: 'portal_rating_count',
        rows: rowsWith({
          [lobby]: { code: 'created', programId: 'program-9', targetValue: 1200 },
        }),
        targets: { [lobby]: 1200 },
        onTargetChange: () => undefined,
        rowRef: () => undefined,
      }),
    )
    const row = rowOf(html, 'Lobby QR')

    expect(fieldIn(row)).toBeUndefined()
    expect(row).toContain('>1,200</p>')
    expect(row).toContain('Goal saved')
    // Its name is read with the goals; until then the link says where it goes.
    expect(row).toMatch(
      new RegExp(
        `<a [^>]*href="/properties/${BULK_PROPERTY.id}/goals/program-9"[^>]*>View goal</a>`,
        'u',
      ),
    )
  })
})
