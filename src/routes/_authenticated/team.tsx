import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/team')({
  component: StaffTeam,
})

function StaffTeam() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Team</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        View your team members and activity.
      </p>
      <div className="mt-6 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Team overview will appear here.
      </div>
    </>
  )
}
