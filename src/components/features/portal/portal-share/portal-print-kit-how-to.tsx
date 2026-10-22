// "How to print", closed until asked: the steps for the chosen piece
// (print-kit-how-to-print). A native disclosure, so it needs no state of its own
// and stays as the manager left it while they switch piece or language.

import { ChevronRight } from 'lucide-react'

export function PortalPrintKitHowTo({ steps }: Readonly<{ steps: readonly string[] }>) {
  return (
    <details className="group rounded-lg border px-3">
      <summary className="focus-ring flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
        />
        How to print
      </summary>
      <ul className="list-disc space-y-1.5 pb-3 pl-9 text-sm text-muted-foreground">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ul>
    </details>
  )
}
