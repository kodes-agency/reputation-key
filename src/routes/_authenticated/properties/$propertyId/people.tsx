import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/people')({
  component: PeoplePage,
})

function PeoplePage() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">People</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage team members and staff assignments.
      </p>
      <div className="mt-6 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        People directory will appear here.
      </div>
    </>
  )
}
