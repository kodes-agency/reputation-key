# OBS-01 local implementation evidence — 2026-08-28

This record closes only the repository-owned implementation axis for OBS-01.
It is not a deployed-monitoring, provider-region, alert-delivery, retention, or
legal approval record.

## Implemented locally

- Always-on error-monitoring entry points exist for web, worker, and retained
  sidecars, with release, environment, and Data Cell metadata plus centralized
  prohibited-field scrubbing.
- The synthetic privacy canary traverses logging, tracing, metric labels,
  durable facts, error monitoring, and the beta-feedback attachment boundary.
- AccountAdmin and PropertyManager Bug/Suggestion flows use bounded, sanitized
  metadata and private receipts. Suggestions are text-only.
- Bug attachment consent captures nothing by itself. A separate preview action
  creates only an allowlisted masked-layout wireframe; managers can preview or
  remove it, and cancel/unmount discards it. Replay and ordinary screenshots
  remain disabled.
- Content-free delivery and revision-fenced triage state are durable in
  PostgreSQL. The operator path is report-first, auditable, and does not create
  engineering issues automatically.
- Critical `cell-us` journey signals, support/incident ownership, calm response
  expectations, containment actions, runbooks, and external-evidence gates are
  executable repository authorities.

## Verification run

On 2026-08-28, the focused unit matrix passed 11 files / 71 tests. It covered
authorization, rate limits, attachment format/lifecycle, privacy exfiltration,
provider preload/wiring, critical-journey signals, migration shape, and support
operations. The isolated fresh-schema PostgreSQL matrix passed 1 file / 5 tests
for prepare, delivery, triage transitions, concurrency, and content-free
evidence. Total: 12 files / 76 tests.

## External gates deliberately still open

The following require an authorized deployed environment, provider account,
operator, or legal decision and cannot be replaced by local mocks:

- Germany project/region and subprocessor inspection;
- one retained test event from every active `cell-us` process;
- inbound scrubber and source-map inspection;
- actual alert-delivery and incident-handoff drill;
- provider-enforced attachment expiry/retention evidence;
- supported-device preview/remove/cancel journey;
- approved notice and retention terms.

The canonical machine-readable list remains
`OBS01_EXTERNAL_EVIDENCE_GATES` in
`src/shared/observability/beta-support-operations.ts`.
