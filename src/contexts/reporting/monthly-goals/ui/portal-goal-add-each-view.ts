// The read owns eligibility and recommended numbers. Only selected eligible rows are
// sent, and a number counts as recommended only while unchanged. Preserve per-row
// failures when a batch partially succeeds.

import type { PortalGoalAddOptions } from '#/contexts/reporting/application/dto/monthly-portal-goal-add.types'
import { formatNumber } from '#/lib/format'
import { subjectRow } from './portal-goal-add-view'
import { stepsFrom } from './portal-goal-sheet-view'
import { portalGoalUnit } from './portal-goal-words'

/** Each row as the manager has left it, by Portal: ticked or not, and its number. */
export type PortalGoalAddEachDraft = Readonly<
  Record<string, Readonly<{ ticked: boolean; number: number | null }>>
>

/** The rows as the read offers them. */
export function eachDraftOf(options: PortalGoalAddOptions): PortalGoalAddEachDraft {
  return Object.fromEntries(
    options.eachPortal.map(({ offer, ticked, number }) => [
      offer.subject.kind === 'portal' ? offer.subject.portalId : '',
      { ticked, number },
    ]),
  )
}

/** A row ticked or not. */
export const tickedEach = (
  draft: PortalGoalAddEachDraft,
  portalId: string,
  ticked: boolean,
): PortalGoalAddEachDraft => ({
  ...draft,
  [portalId]: { number: draft[portalId]?.number ?? null, ticked },
})

/** A row's − or +: its new number, and it is ticked, since it now has one wanted. */
export const steppedEach = (
  draft: PortalGoalAddEachDraft,
  portalId: string,
  to: number,
): PortalGoalAddEachDraft => ({ ...draft, [portalId]: { ticked: true, number: to } })

const NOT_SAVED = 'Not saved, try again'

/** "Set 2 goals", "Set 1 goal"; "Set goals" with nothing ticked. */
function primaryOf(count: number): Readonly<{ label: string; disabled: boolean }> {
  if (count === 0) return { label: 'Set goals', disabled: true }
  return { label: `Set ${count} ${count === 1 ? 'goal' : 'goals'}`, disabled: false }
}

export function eachModel(
  options: PortalGoalAddOptions,
  draft: PortalGoalAddEachDraft,
  failed: ReadonlySet<string>,
) {
  const { measure } = options
  const rows = options.eachPortal.flatMap(({ offer }) => {
    if (offer.subject.kind !== 'portal') return []
    const { portalId } = offer.subject
    const base = subjectRow(offer)
    const own = draft[portalId]
    const number = own?.number ?? null
    const steps = stepsFrom(
      number === null ? { kind: 'empty' } : { kind: 'whole', n: number },
    )
    const named = (verb: 'Lower' | 'Raise', to: number | null) => ({
      label:
        to === null
          ? `${verb} ${offer.name}`
          : `${verb} ${offer.name} to ${formatNumber(to)}`,
      to,
    })
    return [
      {
        portalId,
        name: offer.name,
        ticked: !base.disabled && (own?.ticked ?? false),
        disabled: base.disabled,
        number,
        figure: number === null ? '–' : formatNumber(number),
        unit: portalGoalUnit(measure, number ?? 0),
        note: failed.has(portalId) ? NOT_SAVED : base.note,
        held: base.held,
        recommended: offer.choices?.aBitMore ?? null,
        lower: named('Lower', steps.lower.to),
        raise: named('Raise', steps.raise.to),
      },
    ]
  })
  const items = rows.flatMap(({ portalId, ticked, number, recommended }) =>
    ticked && number !== null
      ? [
          {
            portalId,
            targetValue: number,
            targetSource:
              number === recommended ? ('recommended' as const) : ('own' as const),
          },
        ]
      : [],
  )
  return {
    description: 'A goal for each portal',
    rows,
    primary: primaryOf(items.length),
    submission:
      items.length === 0 ? null : { metric: measure, startMonth: options.month, items },
  }
}

/** "2 portal goals set", "1 portal goal set". */
export const eachToast = (count: number): string =>
  `${formatNumber(count)} portal ${count === 1 ? 'goal' : 'goals'} set`
