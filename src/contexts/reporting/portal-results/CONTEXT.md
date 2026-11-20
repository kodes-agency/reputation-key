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
Guest and effective metric readings. All Time uses the same governed sums and
evidence as bounded windows, without comparison or a time series. Its label follows
the server's retention activation state: "All time" while inactive, "Last 24 months"
when active. `portal-analytics.repository.server.ts` owns
the governed SQL and rejects invalid bounded periods before database work.
The shared SQL and policy helpers also serve the Portals overview and last-scan
read; they remain server-only. The Portals overview
(`get-portal-results-overview.server.ts`, `portal-results-overview-repository.server.ts`,
`portal-last-scans.server.ts`), link taps (`get-portal-link-taps.server.ts`), time ranges
(`time-range.server.ts`) and the staff self reads (`staff-results-reader.server.ts`) live
here too. Each port sits beside its implementation as `*.port.server.ts`. Central schema
paths are unchanged.

The colocated unit suites cover periods, floors, evidence, copy, chart models
and persistence refusals. The two story files run through the standard Storybook
project with accessibility and shared phone-width checks. Database suites use
`.integration.test.ts` so the unit project never starts them.
