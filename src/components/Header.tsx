import { Link } from '@tanstack/react-router'
import { authClient } from '#/shared/auth/auth-client'
import ThemeToggle from '#/components/ThemeToggle'

export default function Header() {
  const { data: session } = authClient.useSession()
  const isLoggedIn = !!session?.user

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)] px-4 backdrop-blur-lg">
      <nav className="page-wrap flex flex-wrap items-center gap-x-3 gap-y-2 py-3 sm:py-4">
        <h2 className="m-0 flex-shrink-0 text-base font-semibold tracking-tight">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1.5 text-sm text-[var(--sea-ink)] no-underline shadow-[0_8px_24px_rgba(30,90,72,0.08)] sm:px-4 sm:py-2"
          >
            <span className="h-2 w-2 rounded-full bg-[linear-gradient(90deg,#56c6be,#7ed3bf)]" />
            Reputation Key
          </Link>
        </h2>

        <div className="ml-auto flex items-center gap-1.5 sm:ml-0 sm:gap-2">
          <ThemeToggle />
          {isLoggedIn ? (
            <>
              <Link
                to="/dashboard"
                className="rounded-lg border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1.5 text-sm font-semibold text-[var(--sea-ink)] no-underline shadow-[0_8px_22px_rgba(30,90,72,0.08)] transition hover:-translate-y-0.5"
              >
                Dashboard
              </Link>
              <button
                type="button"
                onClick={() => authClient.signOut()}
                className="rounded-lg border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1.5 text-sm font-semibold text-[var(--sea-ink-soft)] no-underline shadow-[0_8px_22px_rgba(30,90,72,0.08)] transition hover:-translate-y-0.5"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="rounded-lg border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1.5 text-sm font-semibold text-[var(--sea-ink)] no-underline shadow-[0_8px_22px_rgba(30,90,72,0.08)] transition hover:-translate-y-0.5"
              >
                Sign in
              </Link>
              <Link
                to="/register"
                className="rounded-lg border border-[var(--lagoon)] bg-[var(--lagoon)] px-3 py-1.5 text-sm font-semibold text-white no-underline shadow-[0_8px_22px_rgba(30,90,72,0.08)] transition hover:-translate-y-0.5"
              >
                Get started
              </Link>
            </>
          )}
        </div>

        <div className="order-3 flex w-full flex-wrap items-center gap-x-4 gap-y-1 pb-1 text-sm font-semibold sm:order-2 sm:w-auto sm:flex-nowrap sm:pb-0">
          {isLoggedIn && (
            <>
              <Link
                to="/dashboard"
                className="nav-link"
                activeProps={{ className: 'nav-link is-active' }}
              >
                Dashboard
              </Link>
            </>
          )}
          <Link
            to="/"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
          >
            Home
          </Link>
        </div>
      </nav>
    </header>
  )
}
