// What the "Your response" section offers a guest, and in what words (board
// G07), before any markup: which rows exist, what each says about its
// deadline, and when a row has run out of time. Pure, so it is table-driven
// over both packs.

import { describe, expect, it } from 'vitest'
import type { GuestResponseView } from '#/contexts/guest/application/use-cases/guest-response-lifecycle'
import { PACKS } from './__fixtures__/immersive-response-fixtures'
import { responseSectionRows, type ResponseClock } from './immersive-response-rows'

const CLOCK: ResponseClock = { now: '2026-09-30T09:00:00.000Z', timeZone: 'Europe/Sofia' }

const RESPONSE: GuestResponseView = {
  status: 'submitted',
  rating: 2,
  hasPrivateFeedback: true,
  privateFeedbackEligible: false,
  submittedAt: '2026-09-30T08:50:00.000Z',
  correctedAt: null,
  correctionDeadline: '2026-09-30T12:32:00.000Z',
  correctionAvailable: true,
  responseWithdrawalDeadline: '2026-10-01T11:32:00.000Z',
  responseWithdrawalAvailable: true,
  feedbackSubmittedAt: '2026-09-30T08:55:00.000Z',
  feedbackWithdrawalDeadline: '2026-10-01T11:32:00.000Z',
  feedbackWithdrawalAvailable: true,
  feedbackWithdrawnAt: null,
  deletedAt: null,
}

const rowsFor = (pack: (typeof PACKS)[number], response: Partial<GuestResponseView>) =>
  responseSectionRows(pack, { ...RESPONSE, ...response }, CLOCK)
const ids = (rows: ReturnType<typeof rowsFor>) => rows.map((row) => row.id)

describe.each(PACKS)('the rows of "Your response" [$locale]', (pack) => {
  it('offers change, remove note and remove all, in that order, once a note is sent', () => {
    expect(ids(rowsFor(pack, {}))).toEqual(['change', 'remove-note', 'remove-all'])
  })

  it('leaves out the note row when there is no note to remove', () => {
    expect(ids(rowsFor(pack, { hasPrivateFeedback: false }))).toEqual([
      'change',
      'remove-all',
    ])
  })

  it('titles each row and names its button from the pack', () => {
    const [change, note, all] = rowsFor(pack, {})
    expect(change).toMatchObject({
      title: pack.copy.responseChangeTitle,
      actionLabel: pack.copy.ratingChange,
      actionName: pack.copy.responseChangeTitle,
    })
    expect(note).toMatchObject({
      title: pack.copy.responseRemoveNoteTitle,
      actionLabel: pack.copy.responseRemoveNoteAction,
      actionName: pack.copy.responseRemoveNoteTitle,
    })
    expect(all).toMatchObject({
      title: pack.copy.responseRemoveAllTitle,
      actionLabel: pack.copy.responseRemoveAllAction,
      actionName: pack.copy.responseRemoveAllTitle,
    })
  })

  it('words each deadline in the portal zone, with today and tomorrow', () => {
    const [change, note, all] = rowsFor(pack, {})
    expect(change?.detail).toBe(
      pack.locale === 'bg'
        ? 'До 15:32 днес, местно време в София'
        : 'Until 15:32 today, Sofia time',
    )
    expect(note?.detail).toBe(
      pack.locale === 'bg'
        ? 'До 14:32 утре, местно време в София'
        : 'Until 14:32 tomorrow, Sofia time',
    )
    // Removing everything also says what it does not reach.
    expect(all?.detail).toBe(`${note?.detail}. ${pack.copy.responseRemoveAllNote}`)
  })

  it('says the time has ended, and offers no button, once a window has closed', () => {
    const [change, note, all] = rowsFor(pack, {
      correctionAvailable: false,
      feedbackWithdrawalAvailable: false,
      responseWithdrawalAvailable: false,
    })
    expect([change?.actionable, note?.actionable, all?.actionable]).toEqual([
      false,
      false,
      false,
    ])
    expect(change?.detail).toBe(pack.copy.windowEndedChange)
    expect(note?.detail).toBe(pack.copy.windowEndedNote)
    expect(all?.detail).toBe(pack.copy.windowEndedAll)
  })

  it('closes each window on its own: a closed change window leaves removal open', () => {
    const [change, note, all] = rowsFor(pack, { correctionAvailable: false })
    expect([change?.actionable, note?.actionable, all?.actionable]).toEqual([
      false,
      true,
      true,
    ])
  })

  it('names a later day by its date, joined by the pack and never by the engine', () => {
    const [change] = rowsFor(pack, { correctionDeadline: '2026-10-04T09:05:00.000Z' })
    expect(change?.detail).toBe(
      pack.locale === 'bg'
        ? 'До 4.10.2026 г., 12:05, местно време в София'
        : 'Until Oct 4, 2026, 12:05, Sofia time',
    )
  })

  it('prints nothing for a deadline the server did not send, rather than a made-up one', () => {
    const [change] = rowsFor(pack, { correctionDeadline: null })
    expect(change?.detail).toBe('')
  })

  it('reads the same in every process time zone (React #418)', () => {
    const original = process.env.TZ
    try {
      const printed = ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati'].map((zone) => {
        process.env.TZ = zone
        return JSON.stringify(rowsFor(pack, {}))
      })
      expect(new Set(printed).size).toBe(1)
    } finally {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    }
  })
})
