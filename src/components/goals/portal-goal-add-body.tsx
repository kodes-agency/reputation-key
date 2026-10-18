// The add sheet's steps (copy deck M-2…M-14): the header, the step the
// manager is on, the refusal, and the footer with Back (Cancel on the first
// step) and the step's own primary. It moves between steps and hands each send
// up; every word, number and state is the add views'. Moving to a step puts the
// focus on its first control, so a keyboard never loses its place.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PortalGoalAddOptions } from '#/contexts/reporting/application/dto/monthly-portal-goal-add.types'
import { DialogDescription, DialogHeader, DialogTitle } from '#/components/ui/dialog'
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
  ADD_TITLE,
  averageModel,
  chooseModel,
  committedText,
  numberModel,
  offerOf,
  whichModel,
  type PortalGoalAddKind,
  type PortalGoalAddSubmission,
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
  /** The Portals the last save for each could not keep. */
  failed: ReadonlySet<string>
  /** A phone: the smaller figures, and a title clear of the corner close. */
  small: boolean
  /** Set is on its way. */
  pending: boolean
  onPlace: (place: PortalGoalAddPlace) => void
  onEach: (each: PortalGoalAddEachDraft) => void
  onSendOne: (data: PortalGoalAddSubmission) => void
  onSendEach: (data: NonNullable<ReturnType<typeof eachModel>['submission']>) => void
  /** The refusal, above the footer. */
  error: ReactNode
  /** The footer: Back (null on the first step, which has Cancel) and the primary. */
  footer: (back: (() => void) | null, primary: Primary) => ReactNode
}>

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

/** The number box's draft, shared by the number step and the average's. */
function useBox(pending: boolean) {
  const [text, setText] = useState('')
  return {
    text,
    start: (value: number | null) => setText(value === null ? '' : String(value)),
    props: (average: boolean) => ({
      pending,
      onType: setText,
      onCommit: () => setText((current) => committedText(current, average)),
      onStep: (to: number) => setText(average ? to.toFixed(1) : String(to)),
    }),
  }
}

function stepOf(props: Props, box: ReturnType<typeof useBox>): Step {
  const { options, place, pending, small } = props
  switch (place.step) {
    case 'choose': {
      const model = chooseModel(options, place.picked)
      return {
        description: model.description,
        content: (
          <PortalGoalAddChoose
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
      const offer = offerOf(options, place.key)
      if (offer === null) {
        // The read no longer offers it (it was taken a moment ago): choose again.
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
  const box = useBox(props.pending)
  const step = stepOf(props, box)
  const ref = useStepFocus(props.place.step)
  const back = backOf(props.place)
  return (
    <>
      <DialogHeader>
        <DialogTitle className={props.small ? 'pe-12' : undefined}>
          {ADD_TITLE}
        </DialogTitle>
        <DialogDescription>{step.description}</DialogDescription>
      </DialogHeader>
      <form
        ref={ref}
        className="flex flex-col gap-4"
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
