# Monthly goals

`get-portal-goal-page.server.ts` authorizes the requested Program before reading
its details. Property count goals return the monthly-page branch; single Portal,
Portal Group, average and several-subject goals retain their existing pages.
`contracts.ts` holds browser-safe figures, change fences and the several-subject
page contract. RPC files stay in `../server/`.

`subject-assignments.server.ts` owns current-version selection and assignment
holds. Historical assignments and closed monthly results remain intact. Empty
windows hold nothing; stopped goals hold their subjects until the last counted
month ends. Progress and hold reads use the same window predicate.

`ui/portal-goal-several-page.tsx` draws the current subjects, list progress and
Stop through the shared page and action components. Its presentation uses the
Goals list's subject ordering directly from named subjects. The colocated stories
retain their story IDs, Stop interaction and stopped state. Unit acceptance tests
cover historical assignments, visibility, missing progress and retained months;
PostgreSQL command suites (`*.integration.test.ts`) sit here too.
History scopes subjects before pagination, including the continuation and target
provenance; an invisible Program is not found, as in the detail read.

The monthly-goal commands (`monthly-portal-goal*.server.ts`), the Program
service (`goal-programs.server.ts`) and its use cases, the repository
(`goal-program-repository.server.ts` and the files it composes), the maintenance
job, the metric-correction consumer and their tests live here. The browser-safe
files are `contracts.ts`, `goal-program.contracts.ts`,
`monthly-portal-goals.contracts.ts`, `goal-metric-label.contracts.ts`,
`goal-number-steps.contracts.ts` and `goal-pace.contracts.ts`.
`../application/use-cases/goal-program-shared.ts`,
`../application/ports/goal-program.repository.ts` and the month-target rules the
screens run (`goal-effective-month-target`, `goal-month-target-marker`,
`goal-month-target-plan`, `goal-revision-start`, `goal-target-provenance`,
`goal-results-matrix`) stay in `../application/`: browser code reaches them, and
they type-import the port.
