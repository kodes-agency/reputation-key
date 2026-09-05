# BETA-2 — Experience, Public Edge, and Communication

**Status:** Proposed  
**Date:** 2026-07-14  
**Effort:** 8–13 engineering days; 5–8 if portal/guest/email/teams stay dark  
**Depends on:** BETA-0 capability/security envelope; core BETA-1 read/command contracts  
**Unlocks:** A usable small internal cohort and any explicitly accepted public/email surface

## 1. Objective

Turn the reliable core into a coherent, accessible, responsive, honest beta experience. Harden only the external surfaces that the pilot needs. A hidden or disabled feature is acceptable when its route, mutation, worker, schedule, and side effects are also server-disabled.

The initial product journey is intentionally narrow:

1. receive invitation and verify identity;
2. enter an allowed organization/property;
3. understand Google connection/import health;
4. read and filter real reviews;
5. triage, draft, and deliberately publish a reply;
6. see durable success, retry, degraded, or action-required state;
7. disconnect/archive safely with clear consequences.

Guest feedback is rare by product decision and does not block this journey. Portal, guest submissions, QR/NFC, uploads, email notifications, teams, goals, badges, and leaderboards remain dark unless promoted through the gates below.

## 2. Quality targets

The current UI audit baseline is:

| Dimension                | Baseline |   BETA-2 target for enabled critical flows |
| ------------------------ | -------: | -----------------------------------------: |
| Accessibility            |      2/4 |        4/4 evidence for WCAG 2.2 AA target |
| Performance              |      1/4 | 3/4 with field instrumentation and budgets |
| Theming                  |      3/4 |                4/4 across supported states |
| Responsive               |      2/4 |     4/4 on supported mobile/tablet/desktop |
| Anti-patterns/resilience |      2/4 |                      4/4 for enabled paths |

These scores are internal quality indicators, not legal-conformance claims. Any claim of WCAG conformance requires complete-page/process evaluation against applicable criteria.

## 3. Experience principles

1. **Source truth is visible.** Users can distinguish Google state, local state, processing lag, and action required.
2. **Irreversible means deliberate.** Publish, disconnect, archive, assignment removal, and purge show target, impact, and recovery boundary.
3. **Permission and capability are explainable.** The UI does not pretend a disabled or unauthorized feature is merely broken.
4. **No color-only status.** Text/icon/shape and accessible names carry sentiment-free review status, priority later, connection health, and errors.
5. **Real content is adversarial layout input.** Long names, emoji, translations, RTL text, missing photos/names, and large result sets cannot break actions or expose data.
6. **Mobile is a supported workflow, not a squeezed desktop.** Reading, triage, and reply approval work with touch and zoom.
7. **Reduced motion and stable focus are defaults.** Motion is purposeful and optional; async updates do not steal focus.
8. **External effects require explicit human intent.** Optimistic UI never claims that Google or email completed before durable confirmation.

## 4. Work packages

### B2.1 — Define critical journeys and information architecture

Tasks:

1. Create a role/property journey map for owner, admin, and member. Remove or capability-hide navigation that does not belong to the initial beta.
2. Make the property context, processing/import health, and pending action visible without overloading the root layout.
3. Define first-run states:
   - invited but email not verified;
   - organization ready but no property;
   - property ready but Google not connected;
   - connection importing;
   - import partial/degraded/reauth required;
   - connected but no reviews;
   - no permission/assignment;
   - property archived or capability suspended.
4. Give every critical page loading, empty, partial, stale, error, offline/retry, and permission/capability states.
5. Use stable reason-coded user messages. Link actionable failures to the correct reconnect/retry/contact path.
6. Remove dead-end cards, placeholder numbers, and navigation to dark contexts from the beta cohort.

Acceptance evidence:

- each state has a Storybook/page fixture and a browser journey where relevant;
- users can identify property, freshness, and next action without operator explanation;
- no enabled link lands on a capability-denied or unfinished surface.

### B2.2 — Bound root data and high-cardinality selectors

The authenticated root currently loads all properties/organizations. That cannot scale to the 5,000-property target or guarantee minimum disclosure.

Tasks:

1. Create a compact session/organization shell containing only current identity, current organization, current property summary, capabilities, and small unread/health indicators.
2. Replace all-properties/member selectors with server-side cursor search, debouncing, minimum query length where appropriate, bounded page size, and authorization in the query.
3. Persist last selected property through a safe opaque ID tied to current authorization; never trust a stale client selection.
4. Make property route URLs non-sensitive and validate organization/property relationship on every request.
5. Virtualize only after measurement; prefer pagination/search and small DOMs. Keep keyboard navigation and screen-reader announcements correct.
6. Add cache/query keys containing the complete tenant/property scope and invalidate them on assignment/capability changes.
7. Prove TanStack Query/SSR clients and request context are per request with interleaved tenant A/B tests.

Acceptance evidence:

- root payload/query count stays bounded for users with 1, 100, and 5,000 accessible properties;
- concurrent SSR requests cannot share auth/query data;
- selector search cannot reveal names/counts from unauthorized properties;
- keyboard and touch selection work at zoom and narrow widths.

### B2.3 — WCAG 2.2 AA critical-flow program

Tasks:

1. Map applicable Level A/AA success criteria to complete critical processes, not isolated components.
2. Make automated Storybook accessibility checks blocking for every component/state used in critical flows.
3. Add route-level automated checks to Playwright for invitation/login/recovery, property context, Google connection/status, inbox/detail, reply/publish, settings, disconnect/archive, and any enabled public surface.
4. Complete manual tests for:
   - keyboard-only operation, logical focus order, visible focus, no traps;
   - VoiceOver/Safari and one additional screen-reader/browser smoke path;
   - 200% text and 400% browser zoom/reflow;
   - contrast in light/dark, forced/high-contrast where supported;
   - touch target size/spacing;
   - labels, descriptions, errors, status/live announcements;
   - accessible authentication and timeout/session behavior;
   - reduced motion and animation interruption.
5. Replace click-only elements with semantic controls; the existing upload dropzone `div` is one known case.
6. Ensure dialogs focus predictably, have accessible names/descriptions, restore focus, and do not close during a pending irreversible action.
7. Ensure star/rating/status controls expose names and values; never announce decorative icons redundantly.
8. Test long/translated/RTL review text and names, emoji, missing values, invalid dates, and large dynamic updates.

Acceptance evidence:

- a WCAG evaluation report records scope, browsers/assistive technology, findings, exceptions, and evidence;
- no unresolved P0/P1 accessibility defect remains in an enabled critical process;
- every automated violation blocks merge and manual findings have regression coverage where feasible.

### B2.4 — Responsive and browser support

Planning default: current and previous major Chrome, Safari, and Firefox; mobile Safari and Chrome for core reading/triage/publish. Record exact versions at release.

Tasks:

1. Define content-driven breakpoints and supported viewport/zoom matrix.
2. Rework inbox/review detail to preserve review context and primary actions without horizontal scrolling. Use master/detail only where the width supports it.
3. Make tables/cards/forms/dialogs resilient at 320 CSS px and high zoom; convert data tables to accessible alternate layouts only when semantics remain clear.
4. Keep touch actions separated and avoid hover-only affordances.
5. Handle software keyboard, safe areas, sticky actions, long reply text, and pending publish on mobile.
6. Add Playwright projects for Chromium desktop, WebKit desktop/mobile emulation, and Firefox smoke; use real iOS/Safari manual checks before cohort expansion.
7. Test slow network, offline/reconnect, cached old asset after deploy, and navigation during mutations.

Acceptance evidence:

- the entire core journey completes on supported desktop and mobile without hidden controls or layout overflow;
- browser differences have explicit accepted limitations or fixes;
- screenshots/traces are retained for release evidence.

### B2.5 — Theme, typography, motion, and content resilience

Tasks:

1. Keep `DESIGN.md` as the visual contract and remove local hard-coded values where tokens already express the design.
2. Audit every semantic status token in light/dark for contrast and non-color cue. Include success, warning, error, muted, selection, focus, charts, and disabled states.
3. Self-host or intentionally serve fonts under a documented privacy/performance policy; remove render-blocking external CSS `@import`s.
4. Add `prefers-reduced-motion` handling and stop non-essential repeating/parallax/large-transition motion.
5. Define truncation/wrapping rules. Critical review/reply content must remain available, while identifiers/status layouts may truncate with accessible disclosure.
6. Normalize date/time display to property time zone with a clear source; avoid relative-time ambiguity near DST or across operator zones.
7. Make skeletons match final layout to reduce shift; prefer honest progress/status for long imports over indefinite shimmer.

Acceptance evidence:

- light/dark/reduced-motion/long-content visual regression fixtures cover every critical state;
- external font failure does not block legibility or leak unintended review-page metadata;
- time display has property-zone tests including DST boundaries.

### B2.6 — Safe errors, confirmations, and support handoff

Tasks:

1. Map private domain/dependency failures to stable user-facing codes and actions: retry, reconnect, refresh, contact support, or wait.
2. Show correlation/reference ID without exposing raw exception/provider payload.
3. Preserve safe input across retryable failures and clearly mark whether an external action may already have completed.
4. For publish/disconnect/archive/assignment removal/purge, show exact property/review/person, impact, pending work behavior, and recoverability.
5. Add an internal support status view based on sanitized read models: connection state, last successful sync, queue/workflow state, route version, capability reason, and runbook link.
6. Prohibit support from editing production rows manually; expose audited commands for retry, reconcile, suspend, disconnect, and redrive.

Acceptance evidence:

- common failure drills can be resolved from the UI/operator command without database access;
- root error pages and API errors disclose no stack, SQL, secret, token, review text, or cross-tenant identifier;
- irreversible confirmations pass usability and accessibility tests.

### B2.7 — Performance and frontend budgets

Tasks:

1. Make the production build gate work first; record route/chunk sizes and detect regressions.
2. Set route budgets for server response, payload, query count, JS/CSS, and interaction latency for login, property shell, inbox, review detail, reply, and status.
3. Instrument field Core Web Vitals with bounded, privacy-safe dimensions. Target p75 LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1 on supported mobile and desktop.
4. Remove broad root data, avoid client waterfalls, prefetch only bounded authorized data, and use per-request query clients.
5. Paginate/cursor inbox and selectors. Measure long review content and thousands of records.
6. Set cache freshness/tenant keys/invalidation and a correct uncached fallback. A cache outage must degrade rather than leak or corrupt.
7. Add bundle analysis and ensure browser artifacts/source maps contain no server modules or secrets.

Acceptance evidence:

- lab budgets block material regressions and beta RUM is visible by route/device/region without high-cardinality/user content;
- first-property performance meets the master-plan pilot objectives;
- 5,000-property membership does not increase root payload linearly.

## 5. Conditional surface gates

### B2.8 — Outbound transactional email (optional for initial beta)

Default: identity email only to an allowlisted cohort; notification/digest/urgent email off.

Build a deep `OutboundEmail` module if email is promoted:

1. Use a dedicated transactional subdomain with verified SPF/DKIM, monitored DMARC rollout, TLS, named From, and monitored Reply-To.
2. Persist email intent before send with tenant, template/version, recipient classification, idempotency key, capability, and minimal render data.
3. Re-check capability/recipient allowlist before provider call; use the same Resend idempotency key on retry and record provider ID/acceptance.
4. Verify Resend webhook raw-body signature/timestamp, persist unique event ID before 2xx, dedupe, and asynchronously update delivery/bounce/complaint/suppression state.
5. Stop sends to hard-bounce/complaint suppressions and distinguish transactional from future marketing consent/unsubscribe rules.
6. Avoid review text/reviewer identity in email unless separately required, disclosed, and retained safely.
7. Add global, organization, template, and recipient kill switches plus a controlled synthetic delivery monitor.

Enablement evidence:

- sandbox and production-domain authentication pass;
- send-crash/retry never duplicates accepted email within/outside provider idempotency window;
- signed/invalid/duplicate/replayed webhooks and suppression journeys pass;
- non-allowlisted recipients cannot receive a message in beta.

### B2.9 — Guest/public request identity and abuse control (optional)

Default: all guest submissions and public portal writes off. If the product needs them, implement ADR 0035 and a `ClientRequestIdentity` seam.

Tasks:

1. Move guest session creation/validation to the server. Use signed/encrypted, secure, httpOnly, sameSite cookies with bounded lifetime and rotation; do not trust arbitrary client-generated cookie values.
2. Derive network identity only through trusted proxies. Do not use raw `X-Forwarded-For`.
3. Apply layered limits by route, signed session, normalized network prefix, portal/property, and global abuse state; separate read, click, scan, and feedback limits.
4. Define fail behavior: writes fail closed or degrade to a challenge during limiter outage; public reads may remain available through bounded local protection.
5. Validate origin/CSRF, body size, Unicode normalization, URL/redirect allowlist, replay/nonces where necessary, and automation/honeypot/challenge strategy.
6. Make public slugs/tokens non-enumerable enough and prevent response/cache differences from revealing private tenant state.
7. Correct the cookie/privacy copy: do not claim no personal data while IP/user-agent/session identifiers or free text are processed.
8. Apply executable retention/deletion and content moderation/support escalation appropriate to rare guest feedback.

Enablement evidence:

- cookie forgery/rotation cannot reset rate state indefinitely;
- spoofed proxy headers, distributed bursts, replay, malformed/oversize/Unicode payloads, and Redis outage behave as designed;
- public caches and error timing do not leak unpublished portals/properties;
- public flows meet the same accessibility/responsive gate.

### B2.10 — Safe portal upload/image pipeline (optional)

Default: upload capability off. If enabled, implement ADR 0036 and `SafeUpload`.

Tasks:

1. Authorize exact upload purpose/resource and generate tenant/property/user/random object key server-side; reject arbitrary bucket/key/prefix.
2. Presign a private object for one method, short expiry, content-type allowlist, and real byte range where supported. Client-declared size is not enforcement.
3. Finalize only the expected key and current owner. Validate object byte length, magic signature, allowlisted type, dimensions, frame count, and decompression ratio.
4. Read by storage SDK/key, not a user-influenced public URL. If HTTP fetch remains, allowlist own HTTPS origin and reject redirects/private/link-local/metadata/loopback addresses.
5. Bound CPU/memory/time; re-encode accepted images in an isolated worker; quarantine/delete failures and abandoned/incomplete uploads.
6. Block S3 public access/ACLs, use least-privilege service credentials/encryption/lifecycle, and serve only authorized short-lived reads or explicitly public sanitized derivatives.
7. Add ownership, forged MIME, oversize, malicious pixels/decompression, polyglot, arbitrary key, SSRF/redirect, abandoned upload, unauthorized retrieval, and deletion tests.

Enablement evidence:

- no client-controlled path can cause cross-tenant object access or arbitrary server fetch;
- resource-bomb tests stay within worker limits;
- disabled/suspended/purged resource makes source and derivatives unavailable and schedules deletion.

### B2.11 — Teams and recognition contexts (deferred gates)

Default: teams, goals, badges, leaderboards off. Direct property assignment is sufficient for the first pilot unless proven otherwise.

To promote **teams**:

- define whether team is an authorization scope, organization tool, reporting dimension, or all three;
- make membership/assignment changes transactional with tenant consistency and immediate effective-access invalidation;
- prove invitation/deletion/concurrency/last-admin behavior and every dependent context.

To promote **goals/metrics**:

- version metric definitions and eligibility; define property time zone, recurrence/DST, parent/period uniqueness, backfill, correction, and idempotent spawn/evaluation;
- ensure Google-derived metrics are permitted by policy and can be recomputed/deleted.

To promote **badges/leaderboards**:

- decide staff-monitoring disclosure, fairness, privacy, opt-out, dispute/correction, and intended behavior;
- isolate snapshots/awards by property and definition version; make workers deterministic/idempotent;
- complete authorization, lifecycle, accessibility, and product acceptance.

These are separate product phases, not incidental BETA-2 polish.

## 6. Test matrix

| Dimension       | Required cases                                                                       |
| --------------- | ------------------------------------------------------------------------------------ |
| Roles/scope     | owner/admin/member; direct property; removed/suspended; wrong org/property           |
| Content         | empty, very long, emoji, translated, RTL, missing/deleted fields, 1–5 stars          |
| State           | loading, partial, stale, degraded, retry, terminal, permission, capability, archived |
| View            | 320 px through wide desktop; 200% text; 400% zoom; portrait/landscape                |
| Input           | keyboard, touch, pointer, screen-reader smoke, reduced motion                        |
| Theme           | light, dark, high/forced contrast where supported                                    |
| Network         | slow, offline/reconnect, timeout, stale asset after deploy                           |
| Concurrency     | two tabs/managers, session/assignment revoked, publish pending during navigation     |
| Browsers        | supported Chrome/Safari/Firefox plus mobile Safari/Chrome core smoke                 |
| Public optional | abuse, signature, rate outage, origin/CSRF, caching, upload/SSRF                     |

Use generated/synthetic content outside the controlled production property. Do not copy real reviews into screenshots, Storybook, CI traces, or bug reports.

## 7. Sequence and estimates

| Order | Work package                                          |          Estimate | Notes                                  |
| ----: | ----------------------------------------------------- | ----------------: | -------------------------------------- |
|     1 | B2.1 journeys/states and B2.2 bounded shell/selectors |        1.5–2 days | Core, required                         |
|     2 | B2.3 accessibility remediation/evidence               |          2–3 days | Core, required                         |
|     3 | B2.4 responsive/browser and B2.5 theme/content        |      1.5–2.5 days | Core, required                         |
|     4 | B2.6 safe errors/support and B2.7 performance         |      1.5–2.5 days | Core, required                         |
|     5 | B2.8 outbound email                                   |      1.5–2.5 days | Optional; identity-only may be smaller |
|     6 | B2.9 guest identity/abuse                             |      1.5–2.5 days | Optional; keep dark initially          |
|     7 | B2.10 safe upload                                     |      1.5–2.5 days | Optional; keep dark initially          |
|     8 | B2.11 team/recognition promotion                      | Separate estimate | Not initial beta scope                 |

## 8. Exit gate

BETA-2 closes for the initial beta when:

- all enabled critical flows pass blocking automated and manual accessibility evidence;
- supported desktop/mobile/browser journeys complete through real application contracts;
- root/property/member data stays bounded and tenant-safe at target cardinality;
- field/lab performance and bundle/query budgets are observable;
- users can understand source freshness, pending external effects, failures, permissions, and irreversible actions;
- every dark capability is blocked server-side and in workers/schedules;
- any enabled email, public guest, or upload path passes its full independent security/privacy/abuse/delivery gate and has a kill switch.

The phase does not wait for dark recognition or guest features. It records their exclusion and moves the core beta forward.
