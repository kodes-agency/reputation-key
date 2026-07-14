---
status: proposed
---

# 0031 — Google source content and AI processing boundary

Google Business Profile review processing is allowed only through a versioned, executable source policy that keeps raw Google content within a refresh-or-remove cache lifecycle, permits separately stored per-property derivative metadata, and fails closed for any unclassified AI operation. This converts Google's 2026-07-14 written response into an architectural boundary rather than relying on route conventions or developer memory.

## Decision

The review context remains the sole owner of canonical raw Google review and reply content. Raw review text, rating, reviewer information, Google identifiers, and Google-observed reply text are refreshed or removed under the applicable 30-day cache policy; a local read, scheduler touch, copy, backup, or model call never extends that clock. RepKey adopts the conservative interpretation that only a successful authorized Google re-fetch may establish a new cache observation until Google confirms more precise refresh semantics.

AI results may be retained separately only when they are property-scoped derivative metadata that does not reproduce raw content, personally identifiable information, Google identifiers, exact replies, or reversible content fingerprints. Per-review sentiment/category analysis, property-local themes/trends/summaries, and manager-requested reply drafts are conditionally allowed. Cross-property AI reports, organization summaries, automatic reply publication, provider training on submitted data, silent cross-region fallback, and review-derived staff goals/badges/leaderboards are denied.

Every external AI operation requires all of the following at invocation and persistence time:

- an active property-scoped Merchant AI Opt-in and matching enablement epoch;
- an approved capability in the current `SourceContentPolicy`;
- an approved provider deployment for the property's processing region;
- structured reviewer identity removal and approved free-text PII redaction;
- no-training and minimum-retention provider controls with preserved evidence;
- content-safe logs, traces, jobs, events, audit records, and backups; and
- a separate manager-controlled publication command for any reply.

Unknown policy versions, capabilities, consent state, property regions, provider deployments, or redaction profiles deny only the affected AI operation. Review synchronization, inbox work, and human-authored/manual reply management remain available where independently permitted.

This decision supersedes ADR 0003's use of `reviewedAt + 30 days` as the review-cache expiry basis and its three-day post-expiry purge grace. Migration uses explicit first/last successful fetch, refresh-due, and hard-expiry timestamps; expired raw content is not served during a grace period.

The implementation contract and evidence gates live in the [AI and Google Source Governance package](../product-readiness-program-2026-07/ai-governance/README.md). The evidentiary basis is the [Google support response and disposition](../product-readiness-program-2026-07/google-business-profile-ai-policy-response-2026-07-14.md).

## Considered options

- **Treat the support response as documentation only.** Rejected because scattered booleans, routes, and worker conventions are bypassable and cannot prove what happened under a particular policy version.
- **Retain all normalized review data indefinitely and constrain only prompts.** Rejected because it conflates raw source content with permitted derivative metadata and makes deletion, backups, and downstream copies ungovernable.
- **Disable all Google-derived AI permanently.** Rejected because Google conditionally permitted the submitted per-property architecture and the required controls are technically enforceable.

## Consequences

- PRE17 must establish the raw-content lifecycle, property processing profile, source-policy evaluator, deletion participation, and evidence hooks before Phase 17 can call a model.
- Phase 17/18 schemas must keep raw content and derivatives separate and record policy, prompt/schema/model, redaction, consent, provider deployment, and region versions without retaining prompt bodies.
- Backups and restores need purge-ledger or approved erasure behavior so restoration cannot resurrect expired content into service.
- The exact raw-cache refresh semantics, durable previous-reply examples, historical backfill details, and backup treatment remain conservative until a narrower written clarification or approved policy change supersedes this ADR.
