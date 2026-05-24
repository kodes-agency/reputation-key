import { createFileRoute } from '@tanstack/react-router'
import { PageShell } from '#/components/layout/page-shell'

export const Route = createFileRoute('/_authenticated/progress')({
  component: StaffProgressPage,
})

function StaffProgressPage() {
  return (
    <PageShell>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Progress</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Where you are and where you're going.
        </p>
      </div>
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Stats and goals will appear here.
      </div>
    </PageShell>
  )
}
