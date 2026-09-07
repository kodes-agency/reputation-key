# SAFE-01 independent Public Portal / Guest security review — 2026-08-28

## Result

The locally achievable SAFE-01 criteria reviewed here are implemented and have
adversarial executable evidence. Eight concrete defects were found and repaired
test-first. The review found no remaining known local code defect that requires
activating `portal.upload`.

This is **not** permission to activate `portal.upload` and is **not** a deployed
release attestation. The disposable Railway object-store drill, Railway proxy
header proof, and deployed HTTP/CDN proof in [External release gates](#external-release-gates)
remain mandatory. `portal.upload` remains safety-blocked in the executable
capability authority.

The review was performed in a shared, concurrently modified working tree based
on commit `2be81e9c03c3cac0ad35e9548a95169fc18a6b20` on branch
`codex/comprehensive-program-continuation`. Promotion must rerun the consolidated
gates from the eventual immutable commit.

## Scope and constraints

Reviewed:

- the tokenized Public Portal page and direct secondary-link redirect edge;
- Guest scan, private rating, feedback, withdrawal, correction, and session
  boundaries;
- Portal publication, approved secondary destinations, DNS/redirect
  revalidation, and live drift behavior;
- issued upload authorization, browser PUT contract, finalization, image
  processing, stale-worker fencing, and source/orphan cleanup;
- origin/CSRF, cache, referrer, browser security-header, rate-limit, dedupe,
  session, network-pseudonym, and logging behavior;
- the public loader DTO and production browser artifact boundary;
- the cross-replica/process-restart Guest observation-loss monitor, operational
  snapshot, alert, and runbook.

Constraints honored:

- no live Railway, DNS, Google, CDN, or object-store mutation;
- no production/deployed-provider call;
- no activation or allowlisting of `portal.upload`;
- no shared event/job/entry-point catalogue or 42-package status-ledger edit;
- no raw private/source content added to events, logs, tests, or this evidence;
- PostgreSQL integration used a purpose-created local scratch database only;
  it was dropped after the proof.

## Coverage and disposition

| Area                       | Security question                                                                                                                 | Disposition and executable authority                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public token edge          | Can an invalid/inactive token, inactive Property, missing health posture, or denied public decision reveal a Portal?              | Fail closed to the non-enumerating unavailable outcome in `resolve-public-portal-token.ts`; request-time Property lifecycle check bounds projection-consumer lag.                                                                                                                                                                                                                                                                                                 |
| Publication transition     | Can a Portal be published for an inactive Property, or when the lifecycle authority errors?                                       | Fixed in this review. Publication now asks `PropertyLifecyclePublicApi` before destination lookup or command-store effects. Inactive/error deny; unpublish/archive/deactivation paths remain available.                                                                                                                                                                                                                                                           |
| Google destination         | Can the guest receive a stale or mismatched Google URI?                                                                           | No. The Property-owned verified destination must exactly match the immutable publication snapshot epoch/version/URI; errors keep the private gateway available but hide Google. The public DTO exposes status only.                                                                                                                                                                                                                                               |
| Secondary destinations     | Can an immutable snapshot bypass a later quarantine or stale network validation?                                                  | Fixed in this review. Every public resolution intersects snapshot links with exact Organization + Property + URI rows still `approved` and validated within 30 minutes. Repository failure hides secondary links without hiding the private gateway.                                                                                                                                                                                                              |
| Redirect/DNS               | Can approval follow a redirect into a private/literal/mixed-DNS destination?                                                      | The validator permits HTTPS only, default port only, no credentials/fragment/literal/internal address, rejects any mixed public/private answer, pins a vetted IP while retaining the TLS hostname, validates each same-host redirect hop, and bounds redirects/time/body. Live public resolution additionally applies the approval freshness fence above.                                                                                                         |
| Public navigation response | Can direct-link failures enumerate links or leak a Portal token through referrers, cache, or logs?                                | Neutral 404/302 behavior uses `private, no-store` and `no-referrer`. Fixed in this review: unexpected errors no longer serialize/log the upstream Error that may contain the raw token.                                                                                                                                                                                                                                                                           |
| Guest CSRF/origin          | Can cross-site or origin-less mutation invoke Guest commands?                                                                     | Public Guest mutations require the exact configured origin, scoped signed session cookie, and session CSRF nonce. The global server-function CSRF layer rejects cross-site, same-site, and origin-less unsafe requests.                                                                                                                                                                                                                                           |
| Cache/referrer             | Can cookie-bound public state be cached or forwarded in a Referer?                                                                | Every Guest public handler applies `private, no-store` and `no-referrer` before all normal/denial/decoy branches. Cookie-bound handlers add `Vary: Cookie`; the cookie-independent direct redirect intentionally omits only Cookie variance.                                                                                                                                                                                                                      |
| Guest session              | Can a cookie be forged, reused across Portal scope, or extended indefinitely?                                                     | HMAC signature comparison is constant-time; the payload binds Organization/Property/Portal, CSRF nonce, and domain deadline. Cookies are HttpOnly, Secure, SameSite=Lax, path-scoped to the public/server-function routes, and capped at 24 hours without renewal beyond the domain deadline.                                                                                                                                                                     |
| Rate limits                | Can one replica bypass another, can backend loss silently open mutations, or can a malformed legacy key permanently deny traffic? | Shared Redis scopes the session/network edge; durable PostgreSQL pressure/receipts cover rating, feedback, and destination commands. Production mutation posture is fail closed. Fixed in this review: the atomic Lua counter repairs a missing TTL instead of creating permanent lockout.                                                                                                                                                                        |
| Dedupe/integrity           | Can retry/concurrency duplicate a response, destination click, or durable event?                                                  | Command receipts, canonical response rows, and outbox insertion are transactionally coupled; uniqueness is scoped to session/destination as appropriate; qualified scans serialize their decision. Fresh PostgreSQL integration exercised the repository contracts.                                                                                                                                                                                               |
| Network privacy            | Is a raw IP retained or trusted from a caller-controlled forwarding chain?                                                        | Raw IP is not persisted. The derived network key is a daily HMAC scoped by Organization/Portal/action; canonical scans force it to null. Railway mode accepts `x-real-ip` only with Railway edge/request markers and ignores X-Forwarded-For. The real Railway overwrite/strip behavior remains an external proof.                                                                                                                                                |
| Upload issuance            | Can a client choose an object key, overwrite a source, change content envelope, or reuse another tenant's issuance?               | The server derives an opaque issuance key, scopes it to Organization/Property/Portal/purpose, caps it at 15 minutes, signs exact type/size metadata plus `If-None-Match: *`, and stores a single-use durable issuance.                                                                                                                                                                                                                                            |
| Upload finalization        | Can HEAD/GET drift, a replay, or a losing finalizer corrupt/delete a valid source?                                                | HEAD identity/size/type/custom metadata and a safe ETag must match. Processing GET uses `If-Match`, validates actual bytes and bounded image dimensions, and stages the request/outbox atomically. Fixed in this review: only the finalizer that wins the exact issued-to-terminal transition may delete after pre-stage rejection.                                                                                                                               |
| Upload cleanup             | Can a crash strand private sources or delete a published derivative?                                                              | Cleanup is bounded oldest-first, uses issuance-derived keys only, persists source/orphan markers, treats object deletion as idempotent, and never selects finalized public variants as orphans. It stays active while upload creation is dark.                                                                                                                                                                                                                    |
| Upload/provider logging    | Can a private key, ETag, provider URL, or source error reach logs?                                                                | Fixed in this review. Issuance/finalization/image-job failure logs contain stable error codes only; trace sanitization remains the exception boundary. Tests inject private markers and prove logger arguments exclude them.                                                                                                                                                                                                                                      |
| Public DTO/browser bundle  | Does the public page serialize internal tenant/configuration identifiers or raw destinations?                                     | Fixed in this review. An explicit allowlist removes Organization, Property, Portal, slug, publication/configuration digests, sort keys, raw Google URI, and secondary URL. Link/category IDs remain because the guest interaction needs them; the opaque route token necessarily remains in the page URL. Stories/fixtures are excluded from production artifacts.                                                                                                |
| CSP/security headers       | Does the built server default-deny unspecified browser resource classes on success and error paths?                               | Fixed in this review. CSP now includes `default-src 'none'`, `object-src 'none'`, `frame-src 'none'`, and `manifest-src 'self'`; existing script/style/image/connect/font/frame-ancestor/base/form directives remain explicit. The independent booted-artifact regex was updated only after it failed against the strengthened policy.                                                                                                                            |
| Observation loss           | Can fail-open analytics loss disappear on another replica or process restart and then be reported as zero?                        | No known local defect. One global Redis hash couples a continuity epoch and content-free five-minute `scan`/`review_link` buckets, prunes on access, and expires after 24h05m. Missing/corrupt/reset/warming/unavailable state is fail-visible. Private rating is correctly `not_applicable_durable` because its canonical fact and outbox commit atomically. Independent Redis clients plus a newly constructed adapter proved cross-replica/restart continuity. |
| Operations                 | Is observation loss actionable without exposing tenant/content data?                                                              | `OperationsSnapshot` exports counts/continuity only; a P1 `guest.observation-loss` alert fires for loss or unknown completeness, and the operations runbook carries response/recovery steps.                                                                                                                                                                                                                                                                      |

## Findings repaired in this review

### SAFE-PUB-01 — publication did not consult current Property lifecycle

**Severity:** high release-safety defect.

The Portal update path could transition into `published` without asking the
Property lifecycle authority. This allowed publication to race or bypass an
inactive/archived Property even though public reads later failed closed.

Resolution:

- `src/contexts/portal/application/use-cases/update-portal.ts` performs the
  lifecycle check only for a transition into `published`;
- false or lookup failure returns the generic `portal_inactive` domain error;
- the check occurs before Google destination lookup and before the command
  store, so denial/error has no destination or persistence effect;
- transitions away from publication and archive/deactivation recovery remain
  callable;
- `src/contexts/portal/build.ts` injects the Property public API;
- adversarial tests cover inactive, thrown lookup, zero downstream effects,
  and deactivation availability.

### SAFE-REDIR-01 — a publication snapshot could outlive destination quarantine

**Severity:** high public-edge defect.

The immutable publication snapshot held the secondary URL and the token
resolver returned it without consulting the current approval row. A later DNS
drift quarantine therefore did not immediately remove the link from an already
published Portal.

Resolution:

- `src/contexts/portal/application/use-cases/resolve-public-portal-token.ts`
  intersects snapshot URLs with exact currently approved, recently validated
  rows at every public resolution;
- the query is tenant/property/URI scoped and requires validation no older than
  30 minutes (two 15-minute revalidation intervals);
- approval-store errors fail closed for secondary links while retaining the
  primary private review gateway;
- `src/contexts/portal/infrastructure/repositories/portal-approved-destination.repository.ts`
  implements the bounded exact lookup;
- PostgreSQL integration proves that changing a row to quarantine hides the
  snapshot link immediately.

### SAFE-LOG-01 — raw public/provider errors could carry secrets into logs

**Severity:** high privacy defect.

The direct click route and upload boundaries logged upstream Error objects. An
adapter error may contain a raw Portal token, private source key, ETag, or
provider URL.

Resolution:

- direct-link failure logs only a stable code and non-secret link ID;
- upload issuance/finalization and image-job failure logs use stable codes;
- processing continues to throw the original exception to the trace/error
  boundary, whose sanitizer owns exception normalization;
- tests inject secret-marker errors and inspect the complete logger argument
  graph for absence.

### SAFE-UPLOAD-01 — a losing finalizer could delete the winning source

**Severity:** critical if upload capability were active.

Two finalizers could both observe `issued`. If one staged the issuance while
the other received a HEAD/metadata failure, the loser unconditionally deleted
the source object now owned by the winner's processing request.

Resolution:

- pre-stage cleanup calls `rejectIssued` first and deletes only when that exact
  issued-to-terminal transition wins;
- if another transaction staged/consumed the issuance, the losing request
  performs no delete;
- stage-owned `metadata_mismatch`/`expired` terminal outcomes retain their
  safe cleanup behavior;
- a deterministic concurrent-winner test proves an injected HEAD failure
  cannot delete the staged source.

### SAFE-CSP-01 — CSP lacked an explicit default-deny baseline

**Severity:** medium hardening defect.

The policy had specific directives but no `default-src`, and did not explicitly
deny objects or frames. New resource classes could therefore inherit browser
defaults instead of a deny posture.

Resolution:

- added `default-src 'none'`, `object-src 'none'`, `frame-src 'none'`, and
  `manifest-src 'self'`;
- unit assertions pin each directive;
- `scripts/check-security-headers.mjs` initially failed with three CSP drift
  violations against the built server, then its independent expected contract
  was updated and passed on 200, missing-route, and 413 responses.

### SAFE-DTO-01 — public loader serialized internal identifiers and destinations

**Severity:** medium privacy/minimization defect.

The loader passed through the Portal public result, including tenant IDs,
Portal/configuration identifiers, raw Google/secondary URLs, slug, and ordering
metadata that the browser did not need.

Resolution:

- `src/contexts/guest/application/dto/public-portal.dto.ts` constructs an
  explicit field allowlist;
- secondary navigation uses the server-side token/link redirect instead of a
  serialized destination;
- Google exposure is status-only; the later review action resolves its server
  destination;
- public UI types and stories were narrowed accordingly;
- marker tests and a production-browser-artifact scan prove the seeded private
  markers are absent.

### SAFE-RATE-01 — a TTL-less Redis counter caused permanent denial

**Severity:** medium availability defect.

The atomic script applied expiry only when `INCR` returned one. A key left
without a TTL by a legacy implementation or interrupted/manual operation was
incremented forever and permanently denied that scope.

Resolution:

- the Lua script reads TTL and applies the current window when the count is one
  **or** TTL is negative;
- an in-memory adversarial test and a real Redis integration test both seed a
  TTL-less key and prove it becomes bounded;
- error logs remain content-free and distinguish legitimate quota exhaustion
  from backend unavailability.

### SAFE-TEST-01 — parallel repository fixtures shared a Property primary key

**Severity:** test-authority defect, no product-state impact.

The full Guest/Portal integration run exposed that Guest reconciliation and a
Portal link repository fixture used the same Property UUID under different
Organizations. PostgreSQL correctly rejected the cross-tenant collision, so
parallel/future test selection could produce a false product failure.

Resolution:

- `src/contexts/guest/infrastructure/repositories/guest-response-reconciliation.repository.integration.test.ts`
  now uses a fixture UUID namespace not owned by another suite;
- the isolated reconciliation test and the complete 23-file Guest/Portal/Redis
  integration selection passed afterward.

## Important design observations (no local defect found)

1. **Publication snapshots stay immutable.** Live approval is an additional
   execution fence, not a mutation of historical evidence. The response's
   runtime configuration digest reflects the filtered link set while the
   publication digest continues to describe the signed snapshot.
2. **Private review remains available during destination degradation.** Google
   and secondary navigation can fail closed independently without hiding the
   core private rating/feedback gateway.
3. **There is an unavoidable cross-context timing boundary.** Publication and
   Property lifecycle are not one distributed transaction. The transition
   check plus request-time public-read check closes both ends; a Property state
   change in the small interval between the update check and Portal commit can
   create a historical published row, but it cannot make the public gateway
   readable while the Property is inactive.
4. **Pseudonymous abuse controls are still personal-data-adjacent.** The daily
   HMAC rotation and exact retention matter; operators must not repurpose the
   value as a guest identity or place it in product analytics.
5. **The upload adapter's derivative URL is AWS virtual-host shaped.** With a
   Railway or other S3-compatible endpoint, public reachability and URL shape
   are provider facts, not proven by mocks. This is deliberately an external
   drill blocker rather than a speculative local claim.

## Verification evidence

Environment:

- PostgreSQL `17.5` (local disposable database);
- Redis answered `PONG` at the local test endpoint;
- pnpm `10.6.5`;
- execution host had Node `26.4.0`, while the repository pins Node `22.23.2`.
  Every pnpm command therefore printed the engine warning. The immutable
  release rerun must use the pinned Node version even though the results below
  passed.

### Red/green evidence

- Property publication adversarial additions: initial two failures; final
  `update-portal.test.ts` selection 31/31 passed.
- Current secondary approval/quarantine additions: initial two failures; final
  resolver selection 13/13 passed, plus fresh PostgreSQL repository proof.
- Upload concurrent finalizer test failed before the conditional transition
  cleanup and passed after it.
- Direct-link and upload/provider secret-marker log tests failed before log
  minimization and passed after it.
- DTO secret-marker test failed before the explicit projection and passed
  after it.
- TTL-less Redis-key test failed before repair and passed in unit and real
  Redis integration after it.
- Booted header gate failed with three CSP mismatch violations after source
  hardening, then passed after the independent artifact expectation was
  deliberately updated.

### Final commands and results

| Command                                                                                                                                                  | Result                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Focused adversarial unit selection for publication, token resolution, click, upload finalization/processing/server logs, CSP, DTO, and rate limiter      | 9 files, 105 tests passed                                                                           |
| Scoped Public Portal/Guest/public-route/security/rate unit suite                                                                                         | 110 files, 936 tests passed                                                                         |
| `portal.upload` dark/capability authority selection                                                                                                      | 5 files, 96 tests passed                                                                            |
| Fresh-database Redis/session/observation selection (`middleware.integration`, `guest-session.integration`, `guest-observation-loss-monitor.integration`) | 3 files, 5 tests passed                                                                             |
| Fresh-database `src/contexts/portal`, `src/contexts/guest`, and Redis limiter integration selection                                                      | 23 files, 158 tests passed                                                                          |
| Isolated Guest reconciliation integration after fixture correction                                                                                       | 1 file, 2 tests passed                                                                              |
| `pnpm build`                                                                                                                                             | passed; production web artifact and observability preload built                                     |
| `pnpm check:security-headers`                                                                                                                            | passed against the booted production artifact on 200, missing-route, and 413 paths                  |
| `pnpm check:bundles`                                                                                                                                     | passed; entry 111,270/133,120 B gzip, initial 132,477/158,720 B, largest lazy 120,151/128,000 B     |
| `pnpm check:production-artifacts .output`                                                                                                                | passed; 596 files, digest `sha256:1c530cdaa67de86ee9ff0caf77253b14aaeddff5fb2bd43df65043d9922674e3` |
| Production browser fixture-marker scan                                                                                                                   | `org-secret-id`, `property-secret-id`, private destination, place-ID, and sort markers absent       |
| Focused ESLint over all materially changed SAFE-01 paths                                                                                                 | passed, zero diagnostics                                                                            |
| Focused Prettier check over all materially changed SAFE-01 paths                                                                                         | passed                                                                                              |
| `tsc --noEmit` after the Public Portal story/handler type repairs                                                                                        | passed                                                                                              |

The full `pnpm typecheck` was rerun later while other agents were actively
adding unrelated Activity and Metric/Guest work. It stopped on incomplete
concurrent files (`operational-action-history-access` modules not yet present)
and newly changed three-argument Metric call sites outside this review. There
was no SAFE-01/Portal diagnostic in that result. This is shared-tree
convergence evidence, not a waiver: the parent consolidation run must make the
full command green from the final immutable tree.

The repository's default local `test` database also failed one early attempt
before test execution because concurrent migration processes had left migration
0121's `publication_snapshot_id` column already present. A unique scratch
database bootstrapped cleanly and is the integration authority cited above.
The scratch database `safe01_review_20260828_a1` was dropped with force after
the run; it contained test fixtures only and is not recoverable or needed.

## External release gates

These items cannot be truthfully closed by local mocks or a local Redis/Postgres
stack. They are blocking evidence for upload activation/deployed SAFE-01, not
locally missing implementation.

### 1. Disposable Railway object-store/browser drill — blocks `portal.upload`

Run against a disposable bucket and non-production Portal only, with the same
provider class and endpoint style intended for beta:

1. request one issuance and confirm the raw token/secret values do not appear
   in browser-visible DTOs, logs, or tracing;
2. perform a browser-origin PUT with every signed header, including
   `If-None-Match: *`, exact content type, declared size, and issuance metadata;
3. replay the PUT and prove the provider rejects overwrite/precondition failure;
4. omit or alter each signed header in separate attempts and prove rejection;
5. HEAD the object and prove exact key, metadata, size, type, and stable ETag;
6. finalize while racing a replay/second finalizer and prove exactly one stage,
   one processing outbox request, and no loser deletion;
7. mutate/replace the source between HEAD and processing GET and prove
   `If-Match` prevents processing;
8. exercise malformed images, decompression/pixel bounds, oversized actual
   bodies, and unsupported types;
9. confirm the derivative URL emitted by the adapter is reachable through the
   intended Railway/S3-compatible public endpoint and that the private source
   key is not publicly readable;
10. expire/reject/partially process objects, run source/orphan cleanup through
    retry/crash replay, and prove published derivatives are never deleted;
11. verify exact browser CORS origin/method/header exposure and that the
    production CSP `connect-src` contains only the validated public upload
    origin;
12. delete the disposable bucket/data after evidence capture.

Do not change the executable `portal.upload` fate until every step passes and
an independent reviewer accepts the captured provider evidence.

### 2. Railway client-IP trust-boundary drill

Send caller-supplied `X-Forwarded-For`, `X-Real-IP`, `X-Railway-Edge`, and
`X-Railway-Request-Id` variants through the actual Railway public edge. Prove
Railway strips or overwrites the trusted marker/IP headers, the application
ignores X-Forwarded-For, and rate/pseudonym decisions cannot be selected by the
caller. If Railway does not provide that guarantee, replace header inference
with an authenticated proxy boundary before beta.

### 3. Deployed HTTP/CDN response proof

Against the immutable candidate, capture 200, unavailable-token 404, denied
mutation, and oversized 413 responses through the real Railway/CDN path. Prove
the final edge preserves CSP/HSTS/nosniff/frame/permissions headers and the
public Portal-specific `private, no-store`, `Vary: Cookie` where applicable,
and `no-referrer` policy without cache normalization or error-page replacement.

### 4. Deployed observation-loss operational proof

Across at least two web replicas, induce a non-content Guest scan/review-link
observation failure, restart one replica, and prove the shared count and
continuity remain visible in the operations snapshot. Then simulate Redis
unavailability/reset and prove the P1 alert reports completeness unknown rather
than zero. Record alert delivery and runbook acknowledgement without tenant,
session, network, destination, or content fields.

## Materially changed paths

Publication and destination fencing:

- `src/contexts/portal/application/use-cases/update-portal.ts`
- `src/contexts/portal/application/use-cases/update-portal.test.ts`
- `src/contexts/portal/application/use-cases/resolve-public-portal-token.ts`
- `src/contexts/portal/application/use-cases/resolve-public-portal-token.test.ts`
- `src/contexts/portal/application/ports/portal-approved-destination.repository.ts`
- `src/contexts/portal/infrastructure/repositories/portal-approved-destination.repository.ts`
- `src/contexts/portal/infrastructure/repositories/portal-beta-contract.repository.test.ts`
- `src/contexts/portal/build.ts`

Public response, DTO, and browser boundary:

- `src/routes/api/public/p/$token/click/$linkId.ts`
- `src/routes/api/public/p/$token/click/-$linkId.test.ts`
- `src/routes/p/$token.tsx`
- `src/contexts/guest/application/dto/public-portal.dto.ts`
- `src/contexts/guest/application/dto/public-portal.dto.test.ts`
- `src/components/features/guest/public-portal/portal-secondary-links.tsx`
- `src/components/features/guest/public-portal/guest-response-form-types.ts`
- `src/components/features/guest/public-portal/public-portal-content.tsx`
- `src/components/features/guest/public-portal/guest-response-form.stories.tsx`

Upload lifecycle and content-free failure reporting:

- `src/contexts/portal/application/use-cases/finalize-upload.ts`
- `src/contexts/portal/application/use-cases/finalize-upload.test.ts`
- `src/contexts/portal/infrastructure/jobs/process-image.job.ts`
- `src/contexts/portal/infrastructure/jobs/process-image.job.test.ts`
- `src/contexts/portal/server/portals.ts`
- `src/contexts/portal/server/portals-handler.test.ts`

Shared hardening and proof:

- `src/shared/security/security-headers.ts`
- `src/shared/security/security-headers.test.ts`
- `scripts/check-security-headers.mjs`
- `src/shared/rate-limit/middleware.ts`
- `src/shared/rate-limit/middleware.test.ts`
- `src/shared/rate-limit/middleware.integration.test.ts`
- `src/contexts/guest/infrastructure/repositories/guest-response-reconciliation.repository.integration.test.ts`
- `docs/release-evidence/review/safe-01-independent-security-review-2026-08-28.md`

Some listed files also contain concurrent program work by other owners. This
list identifies the paths touched by this review; it does not claim ownership
of every uncommitted line in the shared working tree.
