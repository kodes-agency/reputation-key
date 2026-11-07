# Portal results

The Portal workspace route hands `ui/portal-results-screen.tsx` the Portal,
code status, monthly goal line and authenticated read. The screen derives live
and counted-code states; `ui/portal-analytics-tab.tsx` owns the remembered range,
query, loading and retry states. `ui/portal-analytics-content.tsx` renders the
figures and loads `portal-results-detail-body.tsx` only when detail opens.

`contracts.ts` contains the browser response and request validator. Existing
Reporting presentation exports remain available to the overview and other
callers. The RPC entry stays at `../server/portal-analytics.ts`: it resolves the
session, execution policy and Property-local period before calling Reporting.
`get-portal-analytics.server.ts` checks Property authority and combines Portal,
Guest, metric and lifetime reads. `portal-analytics.repository.server.ts` owns
the governed SQL and rejects invalid bounded periods before database work.
The shared SQL and policy helpers also serve the Portals overview and last-scan
read; they remain server-only. Central schema paths are unchanged.

The colocated unit suites cover periods, floors, evidence, copy, chart models
and persistence refusals. The two story files run through the standard Storybook
project with accessibility and shared phone-width checks. Database suites use
`.integration.test.ts` so the unit project never starts them.
