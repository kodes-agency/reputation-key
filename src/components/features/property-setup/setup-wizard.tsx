import type { ReactNode } from 'react'
import { ProgressSteps } from '#/components/ui/progress-steps'
import {
  SETUP_WIZARD_STEPS,
  setupWizardStepPosition,
  type SetupWizardStepId,
} from './setup-wizard-steps'

type Props = Readonly<{
  step: SetupWizardStepId
  children: ReactNode
}>

export function SetupWizard({ step, children }: Props) {
  const position = setupWizardStepPosition(step)
  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-col gap-2">
        <ProgressSteps
          steps={SETUP_WIZARD_STEPS}
          currentStep={step}
          label="Import steps"
        />
        <p aria-hidden="true" className="text-sm font-medium lg:hidden">
          Step {position.number} of {position.total}: {position.title}
        </p>
      </div>
      {/* Keep the screen mounted so changing steps preserves its form state. */}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
