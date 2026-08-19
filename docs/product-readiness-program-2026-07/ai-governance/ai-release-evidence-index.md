# AI Release-Evidence Index

**Status:** Closed-beta AI release authorized by the owner; public/open beta not approved  
**Version:** `ai-release-gates-v1`  
**Updated:** 2026-08-19  
**Owners:** Product, engineering, privacy, security, operations, release approver

This index is the single release ledger for Google-derived AI. A completed implementation, green test, policy statement, provider FAQ, or individual approval cannot activate a capability by itself. Every required row for the stage must reference candidate-specific evidence and every required role must decide after final evidence.

`ENABLE_GBP_AI` and all AI capabilities remain off unless the current candidate has an approved stage, exact deployment approval, non-expired evidence, and an allowlisted property/capability cohort. Unknown, missing, stale, mixed-SHA, or conflicting evidence denies AI only.

### Deployment environments in scope

This ledger was first written for a staging-plus-production topology. The Railway
environment `google-closed-beta` (approval environment profile
`railway-closed-beta-1`, target phase `railway_closed_beta`) is an **authorized
AI deployment target** for stages B through E — it is not "production only".
The closed beta is single-tenant and operates exclusively on the owner's own
Google Business Profile data, with the owner holding every role decision, so its
cohort gate is the owner's explicit opt-in rather than an external allowlist.
Every technical control in this index applies unchanged there: the same immutable
image digests, the same capability kill/drain heads, the same synthetic canary
before any real-content capability is enabled, and the same content-free
evidence rules. Public/open beta remains out of scope (see §2).

## 1. Evidence rules

Every evidence record must include:

- stage and capability;
- release SHA and immutable service-image digests;
- migration head and schema/control-plane versions;
- processing cell and exact provider-deployment approval version;
- source policy, routing policy, Merchant AI notice, redaction, prompt, schema, model, SDK, and execution-policy versions;
- command/scenario identity, start/end time, environment, and operator/reviewer identities;
- reproducible assertions, bounded code-only outcomes, and artifact digests;
- explicit finding/exception dispositions with owner and expiry; and
- approvals recorded after the final evidence digest.

Evidence must be content-free: identifiers needed for controlled access may live in the restricted control plane, but repository artifacts contain only synthetic case IDs, counts, versions, closed labels, timestamps, and digests. No review/reply/reviewer text, prompt, model output, reasoning, Google identifier, provider body, or reversible content hash is allowed.

A release bundle is invalid if it mixes SHAs/images/config generations, contains a pending required gate, predates a relevant change, has an expired approval/exception, or cannot be reproduced. A hard denial in ADR 0031 cannot be excepted.

## 2. Stage model

Stages are cumulative. Promotion requires all prior stages still valid.

| Stage                         | Permitted operation                                                 | Minimum scope                                                  | Current state                            |
| ----------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------- |
| A — authority/source baseline | No external AI calls                                                | Governance acceptance and real-GBP source lifecycle only       | **Owner-accepted for closed beta**       |
| B — dark infrastructure       | Synthetic/anonymized canary only; all real-data capabilities killed | Railway `google-closed-beta` topology with zero real content   | **Authorized; canary is the entry gate** |
| C — review analysis           | `review_analysis` only                                              | The owner's own named property (any routed region)             | **Authorized for the closed beta**       |
| D — smart reply               | Add manager-requested `reply_drafting`; publication stays separate  | Same named property, owner as the named manager                | **Authorized for the closed beta**       |
| E — property trends           | Add aggregate-only `property_trends`                                | Same named property                                            | **Authorized for the closed beta**       |
| F — controlled cohort         | Same three capabilities                                             | Explicit closed cohort after 14-day named-property observation | **Blocked — needs a second tenant**      |

Public/open beta is not a stage in this index. It requires separate destination-deny infrastructure and a new approved release profile.

## 3. Stage A — authority and source baseline

Required before provider runtime implementation:

| Gate | Required proof                                                                                                                                                                   | Current disposition                                                                                                         |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| A1   | ADR 0031 accepted; source-content, lifecycle/deletion, routing, Merchant AI, and PII-redaction specifications accepted as one package                                            | Pending privacy/security/product/engineering/operations decisions                                                           |
| A2   | Google case-specific response preserved and current public Google policies rechecked                                                                                             | Response preserved; final reviewer acceptance pending                                                                       |
| A3   | Exact OpenAI deployment hard-gate assessment                                                                                                                                     | [Assessment exists](openai-gpt-5-4-mini-us-zdr-assessment.md); runtime rejected because G1–G15 are not proved               |
| A4   | Raw Google lifecycle, refresh/hard-expiry, disconnect/delete, restore, and no-convenience-copy proof                                                                             | Existing BQC evidence is reusable only after candidate/SHA revalidation                                                     |
| A5   | Full-path US data-flow, privacy notice, data inventory, source policy, and provider/subprocessor disposition agree                                                               | Review package updated; legal/privacy acceptance pending                                                                    |
| A6   | Protected `main` with PR-only merge, stale-review dismissal, code-owner/last-push review, conversation resolution, required CI/security/a11y/build checks, and squash-only merge | GitHub ruleset `20890731` active 2026-08-15; readback required at candidate review                                          |
| A7   | Production deployment environment requires an approval and protected branch                                                                                                      | Environment `production` / ID `19948405265` exists; second reviewer, disabled admin bypass, and Railway wiring are required |
| A8   | Five role approvals recorded after final package evidence                                                                                                                        | None recorded                                                                                                               |

**Stage A exit:** all rows accepted, exact provider deployment eligible, and role decisions recorded. Until then, PR1–PR10 AI feature/runtime changes are not authorized by this package.

## 4. Stage B — dark infrastructure and synthetic canary

Required evidence:

- expand migrations and schema/catalog validation;
- AI egress gateway and execution-admission images built, SBOMed, scanned, and deployed with all capabilities killed;
- service identity, mTLS, fixed route, DNS/IP/redirect/metadata/private-tuple denies, no direct app/provider route, and admission non-egress proof;
- exact deployment/configuration attestation, approval expiry/drift fail-closed, secret isolation/rotation, and no model/provider/region fallback;
- synthetic/anonymized Structured Output, response-size, deadline, cancellation, rate-limit, circuit, quota, ambiguous-operation, and provider-error tests;
- `gbp-review-en-v1` corpus digest and all hard leakage/injection/language/resource gates;
- marker scans proving no content in jobs, Redis, DB control tables, logs, traces, metrics, quarantine, crash/core/swap, images, SBOMs, or evidence artifacts;
- global/provider/capability kill, drain, current-state readback, and zero-call-after-kill proof; and
- staging synthetic canary with no real Google content.

**Stage B exit:** engineering, security, privacy, operations, and product accept final synthetic evidence. The closed beta stays dark except for content-free readiness until the synthetic canary passes and the operator restores each capability head.

## 5. Stage C — one-property review analysis

Entry additionally requires:

- one named/owned property in any routed processing region (`us`, `europe`, `global` — the single approved cell serves all three; the closed-beta property is EEA/`europe`), current routing profile, current Merchant AI notice and explicit `review_analysis` opt-in;
- current exact provider/ZDR/configuration evidence and an unexpired Stage B bundle;
- atomic source revision/epoch checks before read/send and after return;
- strict analysis schema, deterministic attention-level rule, idempotent persistence, deletion/revocation/restore proof, and no Inbox reorder/auto-assignment/staff evaluation;
- base Inbox/manual workflows unaffected by every AI denial/fault; and
- quality, latency, cost, quota, queue-age, redaction-denial, provider-fault, and support monitoring.

**Observation:** daily review by named owners; immediate kill on critical leakage, cross-tenant/property access, stale-epoch persistence, duplicate result, unbounded cost, or unresolved P0/P1.

**Stage C exit:** accepted observation evidence before reply drafting is enabled.

## 6. Stage D — manager-requested smart reply

Entry additionally requires:

- explicit per-action generation; no automatic generation or publication;
- one untrusted suggestion, exact tone, strict schema, output PII/leakage scan, and no invented facts/compensation/private contact/legal/medical claims;
- explicit **Use suggestion** adoption, AI-assisted draft provenance, manual editing, and separate **Approve & publish** command;
- rechecks at request/send/return/adoption/submission/publication boundaries;
- ambiguous inference handled without automatic replay and provider publication reconciliation unchanged;
- manual reply drafting remains available under every AI denial/fault; and
- responsive/accessibility/Storybook and focused end-to-end evidence.

**Stage D exit:** accepted named-manager observation with no duplicate publish, content leak, silent adoption, or P0/P1.

## 7. Stage E — property trends

Entry additionally requires:

- deterministic property-local aggregate candidates only; no raw review read, prompt, excerpt, reply, reviewer, Google ID, or cross-property data;
- minimum sample and profile-boundary rules; exact selected-signal subset validation;
- narrative coverage/provenance/limitations labels and exact deterministic UI values;
- previous-report retention on refresh failure and base Dashboard independence; and
- bounded scheduling, no-op on unchanged aggregate revision, quota/cost/latency evidence, deletion/revocation/restore proof.

**Stage E exit:** 14 continuous observed days across Stages C–E, no unresolved P0/P1, current provider/configuration revalidation, and signed quality/latency/cost/deletion/kill evidence.

## 8. Stage F — controlled US cohort

Requires a new candidate bundle, explicit property allowlist, support/on-call capacity, error-budget and budget thresholds, incident/deletion drill, current provider/Google/privacy review, and release approval after all evidence. EU/unresolved/global properties remain denied. Historical backfill and current-reply examples remain denied.

## 9. Stop, rollback, and exception rules

Immediate stop conditions include:

- any raw/PII/provider-ID leakage or cross-tenant/property disclosure;
- call after kill/revoke/delete/expiry or under a stale epoch/profile/approval;
- wrong host/region/model/schema/tool/state feature or unproved fallback;
- provider/ZDR/config evidence expiry or drift;
- duplicate/ambiguous durable result without safe reconciliation;
- deletion/restore/purge failure;
- critical quality/safety event, uncontrolled cost, or unresolved P0/P1; or
- Google/provider/legal policy change that invalidates the accepted basis.

Rollback order is kill → deny new permits → drain/fence → settle/reconcile → purge transient/adopted-unpublished content as required → verify zero calls → then change images/schema. Non-AI Google sync, Inbox, manual drafting, and authorized publication remain available where independently healthy.

Exceptions must identify the exact stage/gate, owner, severity, compensating control, expiry, and approval. No exception may permit provider training, cross-property/organization AI, automatic publication, review-derived workforce scoring/gamification, unredacted external input, unsupported-language fallback, or cross-region/provider/model fallback.

## 10. Approval ledger

No role approval is recorded as of 2026-08-15.

| Stage | Engineering | Security | Privacy/legal | Operations | Product | Release approver |
| ----- | ----------- | -------- | ------------- | ---------- | ------- | ---------------- |
| A     | Pending     | Pending  | Pending       | Pending    | Pending | Pending          |
| B     | Blocked     | Blocked  | Blocked       | Blocked    | Blocked | Blocked          |
| C     | Blocked     | Blocked  | Blocked       | Blocked    | Blocked | Blocked          |
| D     | Blocked     | Blocked  | Blocked       | Blocked    | Blocked | Blocked          |
| E     | Blocked     | Blocked  | Blocked       | Blocked    | Blocked | Blocked          |
| F     | Blocked     | Blocked  | Blocked       | Blocked    | Blocked | Blocked          |

Approval entries must include reviewer identity, role, decision, timestamp, candidate evidence digest, expiry, and signature/ticket reference. An author may hold multiple operational roles during internal beta, but each role decision remains explicit; the release approver cannot waive a hard denial.
