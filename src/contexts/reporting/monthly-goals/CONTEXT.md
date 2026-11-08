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
PostgreSQL command suites remain under `../infrastructure/`.
