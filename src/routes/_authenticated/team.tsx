import { createFileRoute } from '@tanstack/react-router'
import { PageShell } from '#/components/layout/page-shell'

export const Route = createFileRoute('/_authenticated/team')({
  component: StaffTeamPage,
})

function StaffTeamPage() {
  return (
    <PageShell>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Team</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your team members and goals.</p>
      </div>
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Team details will appear here when you're assigned to a team.
      </div>
    </PageShell>
  )
}
