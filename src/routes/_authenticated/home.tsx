import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/home')({
  component: StaffHomePage,
})

function StaffHomePage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Home</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your performance at a glance.
        </p>
      </div>
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Your stats, badges, and goal progress will appear here.
      </div>
    </div>
  )
}
