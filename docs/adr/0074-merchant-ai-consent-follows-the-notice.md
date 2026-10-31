---
status: accepted
date: 2026-10-31
---

# 0074 — Merchant AI consent follows the notice

Merchant consent authorizes the data use described by an acknowledged notice. It
is not consent to an exact prompt, schema, reasoning effort, model or runtime.
This implements the owner's 2026-10-31 decision (A-Q9) within the processing
boundary of [ADR 0031](0031-google-source-content-and-ai-processing-boundary.md)
and the authorization policy of [ADR 0033](0033-authorization-policy.md).

## Decision

Keep three concepts separate:

1. **Merchant authorization:** selected capabilities, acknowledged notice version
   and digest, source scope, grant lineage and state, and capability epochs.
   Recorded runtime maps and provider deployment remain immutable historical
   evidence of the consent ceremony.
2. **Execution selection:** the operation, runtime and provider deployment served
   by the runtime catalogue. New operations and their control fences use this
   selection, independently of the execution recorded at consent.
3. **Compatibility:** an explicit catalogue rule per capability connects execution
   triples with notice version/digest pairs whose data use covers them.
   `isExecutionCompatibleWithConsent` requires both an in-force notice and an
   exact listed capability/runtime/operation/deployment/notice pair. Unknown
   digests, capabilities and execution combinations fail closed.

Explicit catalogue rows supply compatibility rules; a compatible execution may
be registered before serving. Starting provider work additionally requires the
gateway's exact served selection. No retained v2 analysis execution is added to
settlement compatibility.

Reading and delivering already-produced outputs keep their previous rules,
including a stored analysis under a lapsed notice whose grant has not yet
re-consented. Trend report reads, trend scheduling, draft adoption and publication
of untouched AI text retain their existing authorization checks. Guest voice
retains its existing notice/deployment read gate. These paths do not acquire the
new provider-work compatibility requirement; this PR changes nothing visible at
deploy. A lapsed notice still refuses new work with `consent_renewal_required`.

Identity consent queries, drafting, analysis, trends and settlement use the shared
compatibility decision when authorizing new provider work or its settlement.
The gateway independently requires the request to name the exact served
operation, runtime and deployment. Lineage/state, capability membership, source
scope and revisions, epochs, processing profiles, execution-control generations,
receipts and human publication authority retain their exact fences. Identity's
optional fence names `recordedRuntimeProfileVersion` and `servedExecution`
separately.

A notice declares which capabilities it materially changes relative to the
notice it replaces. Re-consent advances only capabilities whose membership or
source scope changed, or whose data use changed across any intervening notice.
Skipped notice versions accumulate those material changes; unknown ancestry is
conservatively material for every capability. Disable/removal, revoke and
re-enable retain their invalidation fences. Only an advancing Review Analysis
epoch resets its analysis frontier and requests historical replay. A
reply-drafting-only notice change preserves Review Analysis and trends epochs.
Its enrollment retains its identity and progress, with the new exact authorization
state-version fence. Reads of existing outputs retain their previous exact notice
and other fences; re-consent does not by itself widen their delivery authorization.

Source policy, routing policy and redaction family changes still advance every
capability epoch enabled before or after the transition, as before this PR,
because they change what data reaches a provider. Capabilities absent on both
sides retain their epochs. Only prompt, schema, effort, model, runtime, operation
or deployment refreshes inside the same notice are technical: they write no
consent evidence and advance no epoch. Settings' `reconsentRequired` stays
notice-based.
Tenant, permission and Property access checks precede the drafting use case;
an out-of-force notice reaches the composer as `consent_renewal_required` with
the notice fix target, before any operation or provider work.

A new notice and explicit acknowledgement are still required when data use
changes: new data, a new purpose, a provider the notice does not name, or changed
retention or processing-posture promises. Technical improvements already inside
those promises need no further consent. Compatibility entries are deliberate
policy changes, never inferred from a runtime's name or historical evidence.

The existing 2026-10-30 notice declares all three capabilities materially changed
when introduced (provider envelope and data-use promises). Its text, digest,
in-force list, prompts and served execution profiles are unchanged by this ADR.

## Database and regressions

Migration 0084 replaces only the live 27-argument
`apply_merchant_ai_transition_v1`; it creates no obsolete overload and rewrites
no evidence. Its material-change calculation and the TypeScript transition use
the same catalogue and epoch rule. All runtime-map CHECK arms remain valid;
Drizzle derives every historical combination from the append-only
`RECORDED_RUNTIME_PROFILE_VERSIONS` catalogue.

The construct file now states the live function and notice-change helper. Old
migrations remain immutable: these two named forward-only definitions are the
explicit exception to 0001 being a byte copy of `db-constructs.sql`. Construct
parity checks require the transition to equal migration 0084 and the notice-change
helper to equal its latest restatement (0088, which adds the 2026-11-01 notice); no
superseded transition body remains authoritative.

Regressions cover compatible runtime/operation/deployment refreshes without
consent writes or epoch bumps; out-of-force notices without provider work;
unknown digests and execution pairs; drafting-only material changes in the
TypeScript and SQL paths; readable historical evidence; and the existing
source/disable/revoke fences on delivery, adoption and publication.

## Dark reply streaming registration (B2, 2026-10-31)

Reply drafting v2 registers `private-beta-global-v3` and its streaming OpenAI
attestation as compatible with the existing in-force notice. The input, purpose,
provider and processing posture remain inside that notice. Compatibility and
serving are separate: the v2 catalogue entry remains unserved, and the gateway's
exact served-execution check still denies it. V1's served deployment and pins
remain unchanged. This registration neither records consent nor advances epochs.
Migration 0086 only widens historical deployment CHECKs and seeds the new control
head. It stores no draft/progress content; browser-owned drafts remain ephemeral.

## Amended 2026-10-31 by ADR 0075

A merchant's opt-in now stands: when a new notice is served, enabled Properties
move to it automatically with the capabilities they had
([ADR 0075](0075-standing-ai-opt-in-renews-automatically.md)). The "explicit
acknowledgement" above applies only to capabilities a Property does not already
have on. Everything else in this ADR is unchanged.

## Drafting-only notice activation (2026-11-01)

Notices in force are per capability, in the browser-safe notice contract and each
runtime catalogue entry. The 2026-11-01 notice is alone in force for
`reply_drafting`; `review_analysis` and `property_trends` also keep the 2026-10-30
notice in force because their data use is unchanged. The same capability-specific
check governs admission, settlement, gateway validation, SQL drafting fences and the
delivery of stored analysis. Until a Property moves to the 2026-11-01 notice,
analysis, trends and Urgent alerts continue under its 10-30 consent while only
drafting answers `consent_renewal_required`, with the `ai_notice` fix target. A head
counts as lapsed, for Settings and for the standing renewal of ADR 0075, when any of
its enabled capabilities is under a notice out of force for that capability, so the
renewal job moves it.

The move advances only the drafting epoch. Analysis and trends epochs and the
analysis watermark remain unchanged, so it neither replays analysis nor interrupts
its alerts or trends, and analysis stored under the 10-30 notice stays visible.
Disabled Properties remain disabled.
