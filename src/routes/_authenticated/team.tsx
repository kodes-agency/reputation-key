import { createFileRoute } from '@tanstack/react-router'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'

export const Route = createFileRoute('/_authenticated/team')({
  component: StaffTeamPage,
})

function StaffTeamPage() {
  return (
    <PageShell>
      <PageHeader title="Team" description="Your team members and goals." />
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Team details will appear here when you're assigned to a team.
      </div>
    </PageShell>
  )
}
