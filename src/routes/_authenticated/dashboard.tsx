// Dashboard — protected placeholder route
import { createFileRoute } from '@tanstack/react-router'
import { authClient } from '#/shared/auth/auth-client'

export const Route = createFileRoute('/_authenticated/dashboard')({
  component: DashboardPage,
})

function DashboardPage() {
  const { data: session } = authClient.useSession()

  return (
    <div className="page-wrap px-4 pb-8 pt-14">
      <section className="island-shell rise-in rounded-2xl p-6 sm:p-10">
        <h1 className="mb-4 text-2xl font-bold text-[var(--sea-ink)]">Dashboard</h1>
        <p className="mb-6 text-[var(--sea-ink-soft)]">
          Welcome back, {session?.user?.name ?? 'User'}!
        </p>
        <p className="text-sm text-[var(--sea-ink-soft)]">
          Your dashboard is ready. Product features will appear here as they're built.
        </p>

        <div className="mt-8">
          <button
            type="button"
            onClick={() => authClient.signOut()}
            className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-medium text-[var(--sea-ink)] transition hover:bg-[var(--surface-strong)]"
          >
            Sign out
          </button>
        </div>
      </section>
    </div>
  )
}
