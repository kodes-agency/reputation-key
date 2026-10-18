import { describe, expect, it } from 'vitest'
import type { PortalGoalSheetFacts } from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { goalRefusal } from './goal-refusal'
import { PORTAL_SHEET_REFUSALS } from './portal-goal-sheet-refusals'
import {
  changedDraft,
  openingDraft,
  portalGoalSheetModel,
  type PortalGoalSheetDraft,
} from './portal-goal-sheet-view'
import {
  OFFER_NOVEMBER as RATINGS_NOVEMBER,
  OFFER_OCTOBER as RATINGS_OCTOBER,
  SHEET_FIRST_WEEKS as FIRST_WEEKS,
  SHEET_READY as READY,
} from './portal-goal.stories.fixtures'

// Seaview on Oct 23 (goldens G1 and G2): November is offered, 35 · 40 · 45
// with 40 recommended over a usual of 240 / 7 (about 34.29); the rest of
// October is 23 · 24 · 25 on top of the 12 that already count; scans 50 · 55 ·
// 60 for November. On Oct 17, the first weeks, nothing is recommended until
// Oct 23.
const SCANS_NOVEMBER = READY.offers.qualified_scans.next

const ratings = { measure: 'portal_rating_count' } as const

const typed = (draft: PortalGoalSheetDraft, text: string, facts = READY) =>
  changedDraft(draft, { kind: 'type', text }, facts)

describe('portalGoalSheetModel', () => {
  it('opens on the recommended choice', () => {
    const model = portalGoalSheetModel(openingDraft(READY, ratings), READY)

    expect(model).toMatchObject({
      title: 'Monthly portal goal',
      description: 'Starts on Nov 1.',
      months: [
        { value: '2026-10', label: 'October' },
        { value: '2026-11', label: 'November' },
      ],
      month: '2026-11',
      band: 'November',
      unit: 'private ratings',
      chosen: 40,
      status: {
        text: 'Recommended · a bit above your usual over the last 2 weeks',
        restore: null,
      },
      notes: [],
      asksEveryGuest: true,
      offer: RATINGS_NOVEMBER,
      switchMeasure: { label: 'Count scans instead', measure: 'qualified_scans' },
      primary: { label: 'Set 40 for November', disabled: false },
      submission: {
        metric: 'portal_rating_count',
        targetValue: 40,
        startMonth: '2026-11',
        targetSource: 'recommended',
      },
    })
    expect(model.number).toEqual({
      text: '40',
      value: 40,
      invalid: false,
      valueText: '40 private ratings',
      lower: { label: 'Lower to 35', to: 35 },
      raise: { label: 'Raise to 45', to: 45 },
    })
    expect(model.choices).toEqual([
      { value: 35, label: '35 · your usual', recommended: false },
      { value: 40, label: '40 · a bit more', recommended: true },
      { value: 45, label: '45 · stretch', recommended: false },
    ])
  })

  it('an own number reads Back to 40, recommended', () => {
    const draft = changedDraft(
      openingDraft(READY, ratings),
      { kind: 'number', value: 45 },
      READY,
    )
    const model = portalGoalSheetModel(draft, READY)

    expect(model.status).toEqual({
      text: 'Your own number',
      restore: { label: 'Back to 40, recommended', value: 40 },
    })
    expect(model.chosen).toBe(45)
    expect(model.primary).toEqual({ label: 'Set 45 for November', disabled: false })
    expect(model.submission).toMatchObject({ targetValue: 45, targetSource: 'own' })
    expect(model.number.lower).toEqual({ label: 'Lower to 40', to: 40 })
    expect(model.number.raise).toEqual({ label: 'Raise to 50', to: 50 })
  })

  it('the link restores 40 and recommended', () => {
    const own = typed(openingDraft(READY, ratings), '52')
    const ownModel = portalGoalSheetModel(own, READY)
    const restore = ownModel.status.restore
    expect(ownModel.chosen).toBeNull()
    if (restore === null) throw new Error('An own number offers the way back')

    const model = portalGoalSheetModel(
      changedDraft(own, { kind: 'number', value: restore.value }, READY),
      READY,
    )

    expect(model.chosen).toBe(40)
    expect(model.status.restore).toBeNull()
    expect(model.submission).toMatchObject({
      targetValue: 40,
      targetSource: 'recommended',
    })
  })

  it('an empty box disables Set goal', () => {
    const model = portalGoalSheetModel(openingDraft(FIRST_WEEKS, ratings), FIRST_WEEKS)

    expect(model.number).toEqual({
      text: '',
      value: null,
      invalid: false,
      valueText: null,
      lower: { label: 'Lower', to: null },
      raise: { label: 'Raise to 1', to: 1 },
    })
    expect(model.primary).toEqual({ label: 'Set goal', disabled: true })
    expect(model.submission).toBeNull()
    expect(model.choices).toBeNull()
    expect(model.offer).toBeNull()
    expect(model.status).toEqual({
      text: 'No recommendation yet. Your number is ready on Oct 23.',
      restore: null,
    })
    // The first weeks open on this month, with what already counts.
    expect(model.description).toBe('Counts from Oct 1 · 8 already count.')
  })

  it('typing an own number in the first weeks enables Set 12 for October', () => {
    const model = portalGoalSheetModel(
      typed(openingDraft(FIRST_WEEKS, ratings), '12', FIRST_WEEKS),
      FIRST_WEEKS,
    )

    expect(model.primary).toEqual({ label: 'Set 12 for October', disabled: false })
    expect(model.submission).toEqual({
      metric: 'portal_rating_count',
      targetValue: 12,
      startMonth: '2026-10',
      targetSource: 'own',
    })
    // No usual to measure it against: no note.
    expect(model.notes).toEqual([])
  })

  it('says only that no number is recommended yet when no ready day is known', () => {
    const facts: PortalGoalSheetFacts = { ...FIRST_WEEKS, readyOn: null }

    expect(portalGoalSheetModel(openingDraft(facts, ratings), facts).status.text).toBe(
      'No recommendation yet.',
    )
  })

  it('notes about 4 times and under half', () => {
    const opening = openingDraft(READY, ratings)

    expect(portalGoalSheetModel(typed(opening, '120'), READY).notes).toEqual([
      'That is about 4 times your usual.',
    ])
    expect(portalGoalSheetModel(typed(opening, '17'), READY).notes).toEqual([
      'That is under half your usual.',
    ])
    expect(portalGoalSheetModel(typed(opening, '60'), READY).notes).toEqual([])
  })

  it('the October option says Counts from Oct 1 · 12 already count', () => {
    const october = changedDraft(
      openingDraft(READY, ratings),
      { kind: 'month', month: '2026-10' },
      READY,
    )
    const model = portalGoalSheetModel(october, READY)

    expect(model).toMatchObject({
      description: 'Counts from Oct 1 · 12 already count.',
      month: '2026-10',
      band: 'October',
      chosen: 24,
      offer: RATINGS_OCTOBER,
      primary: { label: 'Set 24 for October', disabled: false },
      submission: { startMonth: '2026-10', targetValue: 24, targetSource: 'recommended' },
    })
    expect(model.choices?.map(({ label }) => label)).toEqual([
      '23 · your usual',
      '24 · a bit more',
      '25 · stretch',
    ])
  })

  it('a month that cannot be read so far counts from its first day without a count', () => {
    const facts: PortalGoalSheetFacts = {
      ...FIRST_WEEKS,
      ownNumber: {
        ...FIRST_WEEKS.ownNumber,
        current: { key: '2026-10', soFar: { ratings: null, scans: 47 } },
      },
    }

    expect(portalGoalSheetModel(openingDraft(facts, ratings), facts).description).toBe(
      'Counts from Oct 1.',
    )
  })

  it('an own number stays when the month changes without an offer', () => {
    const own = typed(openingDraft(FIRST_WEEKS, ratings), '12', FIRST_WEEKS)
    const november = changedDraft(own, { kind: 'month', month: '2026-11' }, FIRST_WEEKS)

    expect(portalGoalSheetModel(november, FIRST_WEEKS)).toMatchObject({
      description: 'Starts on Nov 1.',
      primary: { label: 'Set 12 for November' },
    })
  })

  it('Count scans instead swaps unit and offers', () => {
    const model = portalGoalSheetModel(
      changedDraft(
        openingDraft(READY, ratings),
        { kind: 'measure', measure: 'qualified_scans' },
        READY,
      ),
      READY,
    )

    expect(model).toMatchObject({
      unit: 'scans',
      chosen: 55,
      offer: SCANS_NOVEMBER,
      asksEveryGuest: false,
      switchMeasure: {
        label: 'Count private ratings instead',
        measure: 'portal_rating_count',
      },
      primary: { label: 'Set 55 scans for November', disabled: false },
      submission: {
        metric: 'qualified_scans',
        targetValue: 55,
        targetSource: 'recommended',
      },
    })
    expect(model.number.valueText).toBe('55 scans')
    expect(model.choices?.map(({ label }) => label)).toEqual([
      '50 · your usual',
      '55 · a bit more',
      '60 · stretch',
    ])
  })

  it('a measure with no number empties the box', () => {
    // Scans first (P-2): "Set a private ratings number" opens on ratings, which have none.
    const scansOnly: PortalGoalSheetFacts = {
      ...READY,
      offers: { ...READY.offers, portal_rating_count: { current: null, next: null } },
    }
    const opened = openingDraft(scansOnly, ratings)

    expect(portalGoalSheetModel(opened, scansOnly)).toMatchObject({
      number: { text: '', value: null },
      status: { text: 'No recommendation yet.', restore: null },
      asksEveryGuest: true,
    })
    const switched = changedDraft(
      typed(opened, '9', scansOnly),
      { kind: 'measure', measure: 'qualified_scans' },
      scansOnly,
    )
    expect(portalGoalSheetModel(switched, scansOnly).chosen).toBe(55)
    expect(
      portalGoalSheetModel(
        changedDraft(
          switched,
          { kind: 'measure', measure: 'portal_rating_count' },
          scansOnly,
        ),
        scansOnly,
      ).number.text,
    ).toBe('')
  })

  it('a month the read no longer offers falls back to the one it opens on', () => {
    // After the month turned, the read offers November and December.
    const turned: PortalGoalSheetFacts = {
      ...FIRST_WEEKS,
      month: '2026-11',
      ownNumber: {
        current: { key: '2026-11', soFar: { ratings: 0, scans: 0 } },
        next: { key: '2026-12' },
      },
    }
    const october = typed(openingDraft(FIRST_WEEKS, ratings), '12', FIRST_WEEKS)

    expect(portalGoalSheetModel(october, turned)).toMatchObject({
      month: '2026-11',
      months: [
        { value: '2026-11', label: 'November' },
        { value: '2026-12', label: 'December' },
      ],
      submission: { startMonth: '2026-11', targetValue: 12 },
    })
  })

  it('words each refusal', () => {
    const refusal = (code: string) =>
      goalRefusal(
        new ServerFunctionError('GoalProgramError', code, code, 409),
        PORTAL_SHEET_REFUSALS,
      )

    // F-1, F-3 and F-4 (today's sentence; the sheet re-reads its months).
    expect(refusal('revision_conflict')).toMatchObject({
      code: 'revision_conflict',
      message: 'Someone changed this goal a moment ago. Here is the latest.',
    })
    expect(refusal('subject_has_goal')).toMatchObject({
      code: 'subject_has_goal',
      message: 'A monthly portal goal was set a moment ago. Here is the latest.',
    })
    expect(refusal('start_month_changed')).toMatchObject({
      code: 'start_month_changed',
      message: 'The month has changed. Check the start and save again.',
    })
  })
})
