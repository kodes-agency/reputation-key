import { Check } from 'lucide-react'

type Props = Readonly<{
  steps: readonly Readonly<{ id: string; title: string; description: string }>[]
  currentStep: string
  label: string
}>

export function ProgressSteps({ steps, currentStep, label }: Props) {
  const currentIndex = steps.findIndex((step) => step.id === currentStep)

  return (
    <ol role="list" aria-label={label} className="flex w-full items-center">
      {steps.map((step, index) => {
        const state =
          index < currentIndex
            ? 'completed'
            : index === currentIndex
              ? 'active'
              : 'inactive'
        return (
          <li
            key={step.id}
            aria-current={index === currentIndex ? 'step' : undefined}
            className="flex items-center gap-3 not-last:flex-1"
          >
            <span className="inline-flex min-w-0 items-center gap-2 p-1">
              <span
                aria-hidden="true"
                data-state={state}
                className="flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-muted bg-background text-sm font-medium text-muted-foreground transition-colors data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=completed]:border-primary data-[state=completed]:bg-primary data-[state=completed]:text-primary-foreground"
              >
                {index < currentIndex ? <Check className="size-4" /> : index + 1}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="sr-only truncate text-sm font-medium lg:not-sr-only">
                  {step.title}
                </span>
                <span className="sr-only truncate text-xs text-muted-foreground lg:not-sr-only">
                  {step.description}
                </span>
              </span>
            </span>
            {index < steps.length - 1 && (
              <span
                aria-hidden="true"
                data-state={index < currentIndex ? 'completed' : 'inactive'}
                className="h-px min-w-4 flex-1 bg-border transition-colors data-[state=completed]:bg-primary"
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}
