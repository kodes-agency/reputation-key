import type { ReactNode } from 'react'
import {
  Stepper,
  StepperContent,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperList,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from '#/components/ui/stepper'
import {
  SETUP_WIZARD_STEPS,
  setupWizardStepPosition,
  type SetupWizardStepId,
} from './setup-wizard-steps'

type Props = Readonly<{
  step: SetupWizardStepId
  children: ReactNode
}>

/**
 * The import wizard's frame. The flow decides the step, so the stepper only
 * shows where the merchant is; each screen brings its own way back.
 */
export function SetupWizard({ step, children }: Props) {
  const position = setupWizardStepPosition(step)
  return (
    <Stepper value={step} nonInteractive className="gap-5">
      <div className="flex flex-col gap-2">
        <StepperList aria-label="Import steps" className="w-full">
          {SETUP_WIZARD_STEPS.map((candidate) => (
            <StepperItem key={candidate.id} value={candidate.id} className="gap-3">
              <StepperTrigger className="min-w-0 cursor-default gap-2 rounded-lg p-1 text-left">
                <StepperIndicator />
                {/* Small screens keep the names for assistive technology and
                    print the current step as a caption instead. */}
                <span className="flex min-w-0 flex-col">
                  <StepperTitle className="sr-only truncate lg:not-sr-only">
                    {candidate.title}
                  </StepperTitle>
                  <StepperDescription className="sr-only truncate lg:not-sr-only">
                    {candidate.description}
                  </StepperDescription>
                </span>
              </StepperTrigger>
              <StepperSeparator className="min-w-4" />
            </StepperItem>
          ))}
        </StepperList>
        <p aria-hidden="true" className="text-sm font-medium lg:hidden">
          Step {position.number} of {position.total}: {position.title}
        </p>
      </div>
      {/* Always mounted: the frame must never unmount a screen, and its state,
          while the stepper catches up with a new step. */}
      <StepperContent value={step} forceMount className="min-w-0">
        {children}
      </StepperContent>
    </Stepper>
  )
}
