import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/home')({
  component: StaffHome,
})

function StaffHome() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Home</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Your personal overview and quick actions.
      </p>
      <div className="mt-6 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Staff home dashboard will appear here.
      </div>
    </>
  )
}
