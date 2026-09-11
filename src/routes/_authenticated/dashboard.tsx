import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * The fleet dashboard is gone; `/properties` is the one place "all my
 * properties" lives (docs/plan/dashboard-redesign.md row 3).
 *
 * The path survives as a redirect because it was the app's universal fallback:
 * every capability denial, the post-login landing, and an unknown number of
 * bookmarks pointed here. Everything that links deliberately has been
 * repointed at `/properties`; this catches the rest rather than 404ing a
 * manager who typed the URL they have typed every morning.
 *
 * What was deleted with the page: a 3,150 px list of the same properties
 * `/properties` already showed, each row carrying three evidence badges whose
 * tooltips exposed `Definition {uuid} · Watermark {iso}`; an org setup
 * checklist pinned above the fold on every visit for as long as it was
 * incomplete; and a time-range picker rendered outside the page shell, above
 * the header it modified.
 */
export const Route = createFileRoute('/_authenticated/dashboard')({
  beforeLoad: () => {
    throw redirect({ to: '/properties', replace: true })
  },
})
