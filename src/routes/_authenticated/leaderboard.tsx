import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/leaderboard')({
  component: StaffLeaderboard,
})

function StaffLeaderboard() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Leaderboard</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        See how you rank among your teammates.
      </p>
      <div className="mt-6 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Leaderboard will appear here.
      </div>
    </>
  )
}
