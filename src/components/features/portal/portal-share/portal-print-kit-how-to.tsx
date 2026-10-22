// "How to print", open until the manager closes it: the numbered steps for the
// style, piece and paper they chose (portal-print-kit-pieces.ts). A native
// disclosure, so it needs no state of its own and stays as the manager left it
// while they switch piece, paper or language.

import { ChevronRight } from 'lucide-react'
import type { PrintKitHowToStep } from '#/shared/domain/portal-print-kit-pieces'

type Props = Readonly<{
  /** What the steps are for: "Paper counter card". */
  title: string
  steps: readonly PrintKitHowToStep[]
}>

/** A step's words, with the phrase it stresses in bold. */
function StepText({ step }: Readonly<{ step: PrintKitHowToStep }>) {
  const { text, strong } = step
  const at = strong === undefined ? -1 : text.indexOf(strong)
  if (strong === undefined || at < 0) return text
  return (
    <>
      {text.slice(0, at)}
      <strong className="font-semibold">{strong}</strong>
      {text.slice(at + strong.length)}
    </>
  )
}

export function PortalPrintKitHowTo({ title, steps }: Props) {
  return (
    <details open className="group rounded-lg border px-3">
      <summary className="focus-ring flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
        />
        How to print · {title}
      </summary>
      {/* The numbers are drawn, so a list with no markers keeps its role for a screen reader. */}
      <ol role="list" className="flex flex-col gap-2 pb-3 text-[13px] leading-5">
        {steps.map((step, index) => (
          <li key={step.text} className="flex gap-3">
            <span
              aria-hidden="true"
              className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium"
            >
              {index + 1}
            </span>
            <span className="text-pretty">
              <StepText step={step} />
            </span>
          </li>
        ))}
      </ol>
    </details>
  )
}
