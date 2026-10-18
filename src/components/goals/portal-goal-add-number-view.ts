// "Add a portal goal"'s number steps, worked out (PLAN PG-20; copy deck M-6,
// M-10, M-14): a goal for one Portal or one group (its band "Reception ·
// December", its own three suggestions, and Set), and the average (a box of
// tenths that starts empty, the number always the manager's own), with what
// each Set sends. The read decides every number (PLAN E12); the only sums here
// are the box's steps (the goal grid for a count, tenths for the average).
// Nothing here throws on what was typed.
import type {
  AddPortalGoalRequest,
  PortalGoalAddOffer,
  PortalGoalAddOptions,
} from '#/contexts/reporting/application/dto/monthly-portal-goal-add.types'
import { formatNumber } from '#/lib/format'
import { goalMetricLabel } from './goal-metric-label'
import { countsFromWords } from './portal-goal-offer-words'
import {
  choicesOf,
  readText,
  stepsFrom,
  takes,
  type PortalGoalSheetModel,
} from './portal-goal-sheet-view'
import { dayWords, monthName, portalGoalCount, portalGoalUnit } from './portal-goal-words'

/** The average private rating, the one goal of the sheet that is not a count. */
export const AVERAGE_METRIC: AddPortalGoalRequest['metric'] = 'portal_rating_average'

/** What a goal for one Portal, one group or the average sends; the host adds the Property. */
export type PortalGoalAddSubmission = Omit<AddPortalGoalRequest, 'propertyId'>

/** The Set button: "Set 22 for December", "Set 55 scans for December"; "Set goal" with no number. */
function primaryOf(
  options: PortalGoalAddOptions,
  number: string | null,
): Readonly<{ label: string; disabled: boolean }> {
  return number === null
    ? { label: 'Set goal', disabled: true }
    : { label: `Set ${number} for ${monthName(options.month)}`, disabled: false }
}

/** M-10: the number step of a goal for one Portal or one group. */
export function numberModel(
  options: PortalGoalAddOptions,
  offer: PortalGoalAddOffer,
  text: string,
) {
  const { measure, month } = options
  const reading = readText(text)
  const value = reading.kind === 'whole' && takes(reading.n) ? reading.n : null
  const choices = offer.choices === null ? null : choicesOf({ choices: offer.choices })
  const submission: PortalGoalAddSubmission | null =
    value === null
      ? null
      : {
          subject: offer.subject,
          metric: measure,
          targetValue: value,
          startMonth: month,
          targetSource: value === offer.choices?.aBitMore ? 'recommended' : 'own',
        }
  return {
    band: `${offer.name} · ${monthName(month)}`,
    description: options.current
      ? countsFromWords(month, offer.soFar)
      : `Starts on ${dayWords(`${month}-01`)}.`,
    unit: portalGoalUnit(measure, value ?? 0),
    number: {
      text,
      value,
      invalid: reading.kind !== 'empty' && value === null,
      valueText: value === null ? null : portalGoalCount(measure, value),
      ...stepsFrom(reading),
    } satisfies PortalGoalSheetModel['number'],
    choices,
    chosen: choices?.find((choice) => choice.value === value)?.value ?? null,
    primary: primaryOf(
      options,
      value === null
        ? null
        : measure === 'portal_rating_count'
          ? formatNumber(value)
          : portalGoalCount(measure, value),
    ),
    submission,
  }
}

/** The average's box: tenths from 1 to 5. */
const LOWEST_AVERAGE = 1
const HIGHEST_AVERAGE = 5
const TENTHS = 10

/** A typed average: a number from 1 to 5 with at most one decimal (a comma or a point). */
function averageOf(text: string): Readonly<{ empty: boolean; value: number | null }> {
  const typed = text.trim().replace(',', '.')
  if (typed === '') return { empty: true, value: null }
  if (!/^\d(\.\d)?$/u.test(typed)) return { empty: false, value: null }
  const value = Number(typed)
  return {
    empty: false,
    value: value >= LOWEST_AVERAGE && value <= HIGHEST_AVERAGE ? value : null,
  }
}

const tenth = (value: number): number => Math.round(value * TENTHS) / TENTHS
/** An average as the sheet says it: "4.5". */
export const averageWords = (value: number): string => value.toFixed(1)

function averageSteps(value: number | null) {
  const step = (verb: 'Lower' | 'Raise', to: number | null) => ({
    label: to === null ? verb : `${verb} to ${averageWords(to)}`,
    to,
  })
  if (value === null) {
    return { lower: step('Lower', null), raise: step('Raise', LOWEST_AVERAGE) }
  }
  return {
    lower: step('Lower', value <= LOWEST_AVERAGE ? null : tenth(value - 1 / TENTHS)),
    raise: step('Raise', value >= HIGHEST_AVERAGE ? null : tenth(value + 1 / TENTHS)),
  }
}

const AVERAGE_UNIT = 'average private rating'

/** M-6, M-14: the average step; its box starts empty, and the number is the manager's own. */
export function averageModel(options: PortalGoalAddOptions, text: string) {
  const { empty, value } = averageOf(text)
  return {
    description: goalMetricLabel(AVERAGE_METRIC),
    band: monthName(options.month),
    unit: AVERAGE_UNIT,
    status: 'Needs 10 private ratings a month.',
    number: {
      text,
      value,
      invalid: !empty && value === null,
      valueText: value === null ? null : `${averageWords(value)} ${AVERAGE_UNIT}`,
      ...averageSteps(value),
    } satisfies PortalGoalSheetModel['number'],
    primary: primaryOf(options, value === null ? null : averageWords(value)),
    submission:
      value === null
        ? null
        : ({
            subject: { kind: 'property' },
            metric: AVERAGE_METRIC,
            targetValue: value,
            startMonth: options.month,
            targetSource: 'own',
          } satisfies PortalGoalAddSubmission),
  }
}

/** The box as Enter or leaving it writes it: a whole count plainly, an average to tenths. */
export function committedText(text: string, average: boolean): string {
  if (average) {
    const { value } = averageOf(text)
    return value === null ? text : averageWords(value)
  }
  const reading = readText(text)
  return reading.kind === 'whole' && Number.isSafeInteger(reading.n)
    ? String(reading.n)
    : text
}
