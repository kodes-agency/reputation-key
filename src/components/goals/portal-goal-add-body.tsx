// The add sheet's steps (copy deck M-2…M-14): the header, the step the
// manager is on, the refusal, and the footer with Back (Cancel on the first
// step) and the step's own primary. It moves between steps and hands each send
// up; every word, number and state is the add views'. Moving to a step puts the
// focus on its first control, so a keyboard never loses its place. It keeps no
// draft of its own: the sheet holds them, since a phone turned on its side
// swaps the frame this is drawn in and mounts it afresh.
import { useEffect, useRef, type ReactNode } from 'react'
import type { PortalGoalAddOptions } from '#/contexts/reporting/application/dto/monthly-portal-goal-add.types'
import { GoalSheetHeader } from './goal-sheet-frame'
import { PortalGoalAddEach } from './portal-goal-add-each'
import {
  eachModel,
  steppedEach,
  tickedEach,
  type PortalGoalAddEachDraft,
} from './portal-goal-add-each-view'
import { PortalGoalAddAverage, PortalGoalAddNumber } from './portal-goal-add-number'
import { PortalGoalAddChoose, PortalGoalAddWhich } from './portal-goal-add-steps'
import {
  averageModel,
  committedText,
  numberModel,
  type PortalGoalAddSubmission,
} from './portal-goal-add-number-view'
import {
  ADD_TITLE,
  chooseModel,
  numberOfferOf,
  offerOf,
  whichModel,
  type PortalGoalAddKind,
} from './portal-goal-add-view'

/** Where the manager is: a step, and what it has picked there. */
export type PortalGoalAddPlace =
  | Readonly<{ step: 'choose'; picked: PortalGoalAddKind | null }>
  | Readonly<{ step: 'portal' | 'group'; picked: string | null }>
  | Readonly<{ step: 'number'; of: 'portal' | 'group'; key: string }>
  | Readonly<{ step: 'each' }>
  | Readonly<{ step: 'average' }>

type Primary = Readonly<{ label: string; disabled: boolean }>

type Props = Readonly<{
  propertyId: string
  options: PortalGoalAddOptions
  place: PortalGoalAddPlace
  each: PortalGoalAddEachDraft
  /** The number box as typed, on the number step and the average's. */
  box: string
  /** The Portals the last save for each could not keep. */
  failed: ReadonlySet<string>
  /** A phone: the smaller figures, and a title clear of the corner close. */
  small: boolean
  /** Set is on its way. */
  pending: boolean
  onPlace: (place: PortalGoalAddPlace) => void
  onEach: (each: PortalGoalAddEachDraft) => void
  onBox: (text: string) => void
  onSendOne: (data: PortalGoalAddSubmission) => void
  onSendEach: (data: NonNullable<ReturnType<typeof eachModel>['submission']>) => void
  /** The refusal, above the footer. */
  error: ReactNode
  /** The footer: Back (null on the first step, which has Cancel) and the primary. */
  footer: (back: (() => void) | null, primary: Primary) => ReactNode
}>

/**
 * The place drawn: the number step goes back to its list once the read says
 * its Portal or group has a goal (it was taken a moment ago), so its row says
 * "Has a goal" and Set cannot be refused again.
 */
function shownPlace(
  options: PortalGoalAddOptions,
  place: PortalGoalAddPlace,
): PortalGoalAddPlace {
  return place.step === 'number' && numberOfferOf(options, place.key) === null
    ? { step: place.of, picked: null }
    : place
}

/** The step that came before, for Back. */
function backOf(place: PortalGoalAddPlace): PortalGoalAddPlace | null {
  switch (place.step) {
    case 'choose':
      return null
    case 'number':
      return { step: place.of, picked: place.key }
    case 'portal':
    case 'group':
    case 'each':
    case 'average':
      return { step: 'choose', picked: place.step }
  }
}

/**
 * A step's first control: the number box, else the picked radio, else the
 * first one open, else the first tick box open. In that order, whatever the
 * order on the page.
 */
export function stepControl(root: ParentNode): HTMLElement | null {
  for (const selector of [
    '[data-autofocus]',
    '[role="radio"][data-state="checked"]',
    '[role="radio"]:not([disabled])',
    '[role="checkbox"]:not([disabled])',
  ]) {
    const found = root.querySelector<HTMLElement>(selector)
    if (found !== null) return found
  }
  return null
}

/** Moving to a step puts the focus on its first control; opening is the sheet's. */
function useStepFocus(step: string) {
  const ref = useRef<HTMLFormElement>(null)
  const shown = useRef(step)
  useEffect(() => {
    if (shown.current === step) return
    shown.current = step
    if (ref.current) stepControl(ref.current)?.focus()
  }, [step])
  return ref
}

type Step = Readonly<{
  description: string
  content: ReactNode
  primary: Primary
  submit: () => void
}>

/** The number box, shared by the number step and the average's; the sheet holds its text. */
function boxOf(props: Props) {
  const { box: text, onBox: setText, pending } = props
  return {
    text,
    start: (value: number | null) => setText(value === null ? '' : String(value)),
    props: (average: boolean) => ({
      pending,
      onType: setText,
      onCommit: () => setText(committedText(text, average)),
      onStep: (to: number) => setText(average ? to.toFixed(1) : String(to)),
    }),
  }
}

function stepOf(props: Props, box: ReturnType<typeof boxOf>): Step {
  const { options, place, pending, small } = props
  switch (place.step) {
    case 'choose': {
      const model = chooseModel(options, place.picked)
      return {
        description: model.description,
        content: (
          <PortalGoalAddChoose
            propertyId={props.propertyId}
            model={model}
            picked={place.picked}
            onPick={(kind) => props.onPlace({ step: 'choose', picked: kind })}
            disabled={pending}
          />
        ),
        primary: { label: 'Next', disabled: model.next.disabled },
        submit: () => {
          const { picked } = place
          if (picked === 'portal' || picked === 'group') {
            props.onPlace({ step: picked, picked: null })
          } else if (picked === 'average') {
            box.start(null)
            props.onPlace({ step: 'average' })
          } else if (picked === 'each') props.onPlace({ step: 'each' })
        },
      }
    }
    case 'portal':
    case 'group': {
      const model = whichModel(options, place.step, place.picked)
      return {
        description: model.description,
        content: (
          <PortalGoalAddWhich
            propertyId={props.propertyId}
            label={model.description}
            rows={model.rows}
            picked={place.picked}
            onPick={(key) => props.onPlace({ step: place.step, picked: key })}
            disabled={pending}
          />
        ),
        primary: { label: 'Next', disabled: model.next.disabled },
        submit: () => {
          if (place.picked === null) return
          box.start(offerOf(options, place.picked)?.choices?.aBitMore ?? null)
          props.onPlace({ step: 'number', of: place.step, key: place.picked })
        },
      }
    }
    case 'number': {
      const offer = numberOfferOf(options, place.key)
      if (offer === null) {
        // Taken a moment ago (`shownPlace` draws its list instead): choose again.
        return stepOf({ ...props, place: { step: place.of, picked: null } }, box)
      }
      const model = numberModel(options, offer, box.text)
      return {
        description: model.description,
        content: (
          <PortalGoalAddNumber model={model} small={small} {...box.props(false)} />
        ),
        primary: model.primary,
        submit: () => {
          if (model.submission !== null) props.onSendOne(model.submission)
        },
      }
    }
    case 'average': {
      const model = averageModel(options, box.text)
      return {
        description: model.description,
        content: (
          <PortalGoalAddAverage model={model} small={small} {...box.props(true)} />
        ),
        primary: model.primary,
        submit: () => {
          if (model.submission !== null) props.onSendOne(model.submission)
        },
      }
    }
    case 'each': {
      const model = eachModel(options, props.each, props.failed)
      return {
        description: model.description,
        content: (
          <PortalGoalAddEach
            propertyId={props.propertyId}
            rows={model.rows}
            pending={pending}
            onTick={(id, ticked) => props.onEach(tickedEach(props.each, id, ticked))}
            onStep={(id, to) => props.onEach(steppedEach(props.each, id, to))}
          />
        ),
        primary: model.primary,
        submit: () => {
          if (model.submission !== null) props.onSendEach(model.submission)
        },
      }
    }
  }
}

export function PortalGoalAddBody(props: Props) {
  const place = shownPlace(props.options, props.place)
  const step = stepOf({ ...props, place }, boxOf(props))
  const ref = useStepFocus(place.step)
  const back = backOf(place)
  return (
    <>
      <GoalSheetHeader
        title={ADD_TITLE}
        description={step.description}
        phone={props.small}
      />
      <form
        ref={ref}
        className="flex flex-1 flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (!step.primary.disabled && !props.pending) step.submit()
        }}
      >
        {step.content}
        {props.error}
        {props.footer(back === null ? null : () => props.onPlace(back), step.primary)}
      </form>
    </>
  )
}
