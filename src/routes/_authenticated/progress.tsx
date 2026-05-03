import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/progress')({
  component: StaffProgress,
})

function StaffProgress() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Progress</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Track your goals and performance over time.
      </p>
      <div className="mt-6 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Progress tracking will appear here.
      </div>
    </>
  )
}
