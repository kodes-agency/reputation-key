import { describe, expect, it } from 'vitest'
import type {
  GoalResultsMatrix,
  GoalResultsMatrixRow,
} from '#/contexts/reporting/application/public-api'
import { resultGoals } from './portal-goal-results-list-view'
import {
  ALL_EVIDENCE_STATES,
  LIST_NOW,
  ONE_AND_THOUSANDS,
  listPersonName,
  monthOf,
  provenanceOf,
  resultRow,
} from './portal-goal-results-list.stories.fixtures'
import {
  MONTHLY_GOAL,
  RESULTS_NOW,
  SEAVIEW_GOALS,
  personName,
  portalGoalBundle,
  resultsOf,
} from './portal-goal-results.stories.fixtures'

const goalsOf = (matrix: GoalResultsMatrix) =>
  resultGoals(matrix, { now: LIST_NOW, personName: listPersonName })

/** July, one result of the Property's scans goal, said as the list says it. */
const rowOf = (overrides: Partial<GoalResultsMatrixRow>) => {
  const [goal] = goalsOf({ months: [monthOf('2026-07', [resultRow('r', overrides)])] })
  const [measure] = goal?.measures ?? []
  const [row] = measure?.rows ?? []
  if (row === undefined) throw new Error('expected a row')
  return row
}

const PROPERTY = { kind: 'property', propertyId: 'property-seaview' } as const
const reception = { kind: 'portal', portalId: 'portal-reception' } as const

/** A goal with one closed month, October: 22 of 20. */
const octoberGoal = (name: string, subject: typeof PROPERTY | typeof reception) =>
  portalGoalBundle({
    id: `goal-${name}`,
    name,
    metric: 'portal_rating_count',
    target: 20,
    subject,
    from: '2026-10',
    months: [{ yearMonth: '2026-10', value: 22, achieved: true }],
  })

describe('resultGoals: the goals', () => {
  const seaview = () =>
    resultGoals(resultsOf(SEAVIEW_GOALS).matrix, { now: RESULTS_NOW, personName })

  it('reads a goal stopped and set again as the one goal: the same name and subject', () => {
    const goals = seaview()

    expect(goals.map(({ title, subject }) => [title, subject])).toEqual([
      ['Monthly portal goal', null],
    ])
  })

  it('names what each block of months counted, where a goal counted more than one thing', () => {
    const [goal] = seaview()

    expect(goal?.measures.map(({ metric, title }) => [metric, title])).toEqual([
      ['portal_rating_count', 'Counted private ratings'],
      ['qualified_scans', 'Counted scans'],
    ])
  })

  it('names no block of a goal that counted one thing', () => {
    const titles = goalsOf(ALL_EVIDENCE_STATES).flatMap(({ measures }) =>
      measures.map(({ title }) => title),
    )

    expect(titles).toEqual([null, null, null, null, null])
  })

  it('lists the months of each block newest first', () => {
    const [goal] = seaview()

    expect(goal?.measures.map(({ rows }) => rows.map(({ month }) => month))).toEqual([
      ['December 2026', 'November 2026', 'October 2026'],
      ['September 2026', 'August 2026'],
    ])
  })

  it('says whom a goal of one Portal counted', () => {
    const matrix = resultsOf([octoberGoal('Reception ratings', reception)]).matrix
    const [goal] = resultGoals(matrix, { now: RESULTS_NOW, personName })

    expect(goal).toMatchObject({ title: 'Reception ratings', subject: 'Reception' })
  })

  it('keeps apart goals of one name that count different subjects', () => {
    const monthly = [octoberGoal('Monthly portal goal', reception), MONTHLY_GOAL]
    const goals = resultGoals(resultsOf(monthly).matrix, {
      now: RESULTS_NOW,
      personName,
    })

    expect(goals.map(({ title, subject }) => [title, subject])).toEqual([
      ['Monthly portal goal', null],
      ['Monthly portal goal', 'Reception'],
    ])
    expect(new Set(goals.map(({ key }) => key)).size).toBe(2)
  })

  it('names the Property’s goal before a Portal’s, as the matrix does', () => {
    const both = [
      octoberGoal('Reception ratings', reception),
      octoberGoal('Monthly portal goal', PROPERTY),
    ]
    const goals = resultGoals(resultsOf(both).matrix, { now: RESULTS_NOW, personName })

    expect(goals.map(({ title }) => title)).toEqual([
      'Monthly portal goal',
      'Reception ratings',
    ])
  })
})

describe('resultGoals: a month’s figure and verdict', () => {
  it('says the figure of the number: "41 of 40", and "–" with no figure', () => {
    const [goal] = resultGoals(resultsOf(SEAVIEW_GOALS).matrix, {
      now: RESULTS_NOW,
      personName,
    })
    const [ratings] = goal?.measures ?? []

    expect(ratings?.rows.map(({ result }) => result)).toEqual([
      '–',
      '36 of 40',
      '41 of 40',
    ])
  })

  it('says one as one and groups thousands', () => {
    const results = goalsOf(ONE_AND_THOUSANDS).flatMap(({ measures }) =>
      measures.flatMap(({ rows }) => rows.map(({ result }) => result)),
    )

    expect(results).toEqual(['1 of 1', '1,234 of 1,200'])
  })

  it('says an average to a tenth against its goal: "4.6 · goal 4.5"', () => {
    const met = rowOf({
      metric: 'portal_rating_average',
      outcome: 'met',
      evidence: { kind: 'average', value: 4.6, sampleCount: 31, minimumSample: 10 },
      targetProvenance: provenanceOf('Spa average', 4.5),
    })

    expect(met).toMatchObject({
      result: '4.6 · goal 4.5',
      verdict: { kind: 'met', text: 'Met' },
    })
  })

  it('says Met for a count over its number, and by how much a count missed it', () => {
    const [goal] = resultGoals(resultsOf(SEAVIEW_GOALS).matrix, {
      now: RESULTS_NOW,
      personName,
    })
    const [ratings] = goal?.measures ?? []

    expect(ratings?.rows.map(({ verdict }) => verdict)).toEqual([
      { kind: 'open', text: 'The final figure is on its way' },
      { kind: 'missed', text: 'Missed by 4' },
      { kind: 'met', text: 'Met' },
    ])
  })

  it('says only Not met for an average that fell short: no distance in tenths', () => {
    const short = rowOf({
      metric: 'portal_rating_average',
      evidence: { kind: 'average', value: 4.2, sampleCount: 20, minimumSample: 10 },
      targetProvenance: provenanceOf('Spa average', 4.5),
    })

    expect(short).toMatchObject({
      result: '4.2 · goal 4.5',
      verdict: { kind: 'missed', text: 'Not met' },
    })
  })

  it('says a month that is still being counted has its final figure on its way', () => {
    const open = rowOf({
      availability: 'updating',
      outcome: 'pending',
      evidence: { kind: 'count', value: 7, sampleCount: 7 },
    })

    expect(open).toMatchObject({
      result: '7 of 100',
      verdict: { kind: 'open', text: 'The final figure is on its way' },
    })
  })

  it('says how many ratings an average still needs', () => {
    const needs = rowOf({
      metric: 'portal_rating_average',
      availability: 'insufficient_data',
      outcome: 'pending',
      evidence: { kind: 'average', value: null, sampleCount: 6, minimumSample: 10 },
    })

    expect(needs).toMatchObject({
      result: '–',
      verdict: { kind: 'open', text: 'More ratings needed: 6 of 10' },
    })
  })

  it('says a month that could not be read has no result, and never a zero', () => {
    const unread = rowOf({
      availability: 'temporarily_unavailable',
      outcome: 'pending',
      evidence: { kind: 'count', value: null, sampleCount: 0 },
    })

    expect(unread).toMatchObject({
      result: '–',
      verdict: { kind: 'open', text: 'No result for this month' },
    })
  })

  it('says a ready month with no verdict yet is still counting', () => {
    expect(rowOf({ outcome: 'pending' }).verdict).toEqual({
      kind: 'open',
      text: 'Still counting',
    })
  })
})
