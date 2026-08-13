# BQC-9 — Local Product Acceptance and Operations Handoff

**Status:** `evidence_pending` — product journeys passed; five post-evidence approvals remain
**Evidence profile:** `beta-local-1`
**Dependencies:** BQC-0 through BQC-8 implementation complete for one immutable local candidate
**Unlocks:** controlled internal beta activation

## 1. Outcome

Run the accepted local production-profile images through clean-install and pre-cutover-upgrade journeys for Inbox, Dashboard, Portals/Guest, Goals, Leadership/recognition, Settings, delayed work, and dependency faults. Prove P1 success, P2/P3 denial, direct-route/resource/token/job/email isolation, and global/property stop controls.

BQC-9 contains no hosted or live-provider inference. Railway capacity/PITR, live Google publication, merchant authorization, real-property observation, and the 14-day cohort move to post-beta operations and remain unmeasured.

## Ownership mode

- Product journey fixtures, local stack orchestration, and digest-keyed evidence: `IMPLEMENTS`.
- Accepted product/runtime controls: `RE_EXECUTES`.
- Final controlled-beta activation: `PROMOTES` only after five post-evidence approvals.

## 2. Entry conditions

- One valid BQC-8 local manifest with zero unresolved P0/P1.
- Exact release revision, clean/upgrade migration heads, policy versions, image digests, and fixture hashes.
- Named engineering/runtime, product/property, security/privacy, Google-project/integration sandbox, and operations/on-call approvers.
- Generated local secrets and provider sandboxes; no real Google, Resend, or public object-store credentials.
- Capability kill switches, suspension, diagnostics, and scoped teardown ready.

## 3. Required local product journeys

1. Org A manager succeeds on allowlisted P1 while the same manager is denied on P2; locked Org B/P3 stays denied. Probe direct routes, opaque resources, tokens, jobs, email, suspension, and global kill switches.
2. Manager Portal CRUD/group/publication/token rotation; links remain usable without response; guest submit/correct/withdraw/media; withdrawal races queued/processing media; archive and retention neutralize every downstream copy.
3. Team creation, member assignment, lead replacement, durable history, staff lead limits, and cross-property denial.
4. Governed Goal create/evaluate/close/correct and Staff read-only. Change America/New_York to America/Los_Angeles across DST fold/gap and prove one future version/period with no wrong-zone spawn.
5. Recognition activation, positive group board, correction reconciliation, group-only Staff visibility, and prohibited-source rejection.
6. Profile, security, organization/member, preferences, notification, recognition, and integration Settings persistence and permission denial.
7. Fleet/property/staff Dashboard values, zero/one/many states, attention-link parity, and 5,000-property query/cursor/overlay bounds.
8. Restart web and worker during queued work; drain/reconciliation is idempotent and produces no duplicate external effect.
9. Fail and restore PostgreSQL, Redis, object store, GBP, and mail one at a time. Health/readiness and affected work fail closed and recover without fabricated success.

Run every product journey once on a clean install and once after the versioned pre-cutover dump completes expand/fence/drain/backfill/validate/cutover.

## 4. Evidence and approval

`pnpm beta:smoke` is the only successful manifest producer. It writes `test-results/beta-smoke/<release-sha>/<manifest-sha256>/manifest.json` plus checksum, binds every result and image identity, and refuses overwrite.

Approvals occur only after the manifest closes. Each approval binds reviewer identity, role, timestamp, manifest digest, release revision, migration heads, and image digests. `pnpm release:promote-local-evidence` is the exclusive repository promotion path.

Final candidate:
`f46d2cd690899eace479e6ec9e08d5bbb3fece4c/6ae52200cfcecac772493e1a3af419b1d2a4140225536aa2d1b33ac263b0953f`.
All 18 promoted browser journeys passed. Promotion remains pending the five
independent approval roles named in the entry conditions.

## 5. Content-minimized measurements

Evidence may contain counts, timings, stable outcomes, queue age/retries/quarantine, policy reason classes, migration/reconciliation counts, image identities, query counts, and content-free hashes. It must not contain review/reply/guest text, identities, emails, raw public tokens, Google identifiers, provider bodies, contact ciphertext, or screenshots with protected content.

## 6. Stop-lines

Pause the affected capability for wrong-tenant/property access, post-withdrawal content, lost state/event, split projection/receipt, duplicate external effects, retired-token execution, prohibited metric eligibility, wrong-region work, failed migration reconciliation, or a material security/privacy/accessibility P0/P1.

Containment order is deny new work, stop scoped schedules/workers, preserve canonical state/evidence, reconcile in-flight outcomes, fix forward, issue a new immutable candidate, and rerun every affected gate. No database rollback or relaxed assertion makes a failed candidate acceptable.

## 7. Final controlled-beta acceptance

| Criterion                                                                       | Required result |
| ------------------------------------------------------------------------------- | --------------- |
| Both deterministic scale fixtures load, verify, and meet declared local budgets | Pass            |
| Clean install and pre-cutover upgrade converge with zero unexplained mismatch   | Pass            |
| Nine product/fault journeys pass across P1/P2/P3 scopes                         | Pass            |
| Capability matrix matches policy, routes, jobs, tokens, and email               | Pass            |
| No unresolved P0/P1; lower findings owned and expiring                          | Pass            |
| Digest-keyed manifest and checksum are non-overwritable                         | Pass            |
| Five approvals are recorded after final evidence and bind the same candidate    | Accepted        |

## 8. Post-beta operations

The following are intentionally outside local acceptance and remain unmeasured: Railway capacity and managed PITR, regional infrastructure outage/no-fallback, live Google provider behavior, merchant authorization, real-property acceptance, and the 14-day cohort. Running them later produces separate immutable evidence; it does not rewrite `beta-local-1`.
