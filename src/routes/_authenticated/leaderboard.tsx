import { createFileRoute } from '@tanstack/react-router'
import { PageShell } from '#/components/layout/page-shell'

export const Route = createFileRoute('/_authenticated/leaderboard')({
  component: StaffLeaderboardPage,
})

function StaffLeaderboardPage() {
  return (
    <PageShell>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Leaderboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          See how you rank among your peers.
        </p>
      </div>
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Rankings will appear here.
      </div>
    </PageShell>
  )
}
