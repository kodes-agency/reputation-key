# Source-Content Policy Specification

**Status:** Proposed normative contract  
**Decision:** [ADR 0031](../../adr/0031-google-source-content-and-ai-processing-boundary.md)  
**Owners:** Engineering, privacy, security  
**Initial policy identifier:** `google-business-profile/2026-07-14.v1`

## 1. Purpose

`SourceContentPolicy` is the single executable answer to “may this operation use or retain this source data under these conditions?” It applies in HTTP/server use cases, workers, schedules, backfills, exports, read models, and model adapters. A route guard or feature flag is not an acceptable substitute.

The policy is provider-source specific and capability specific. It must be possible to update policy facts without rewriting business use cases, while all changes remain versioned, reviewed, testable, and visible in release evidence.

## 2. Normative principles

- Unknown source, data class, capability, policy version, consent epoch, property region, provider deployment, or redaction profile **denies** the AI operation.
- Policy denial must not make independently permitted non-AI review management unavailable.
- Every model call evaluates policy immediately before invocation; delayed jobs do not rely on the decision made when enqueued.
- Every result evaluates policy again before persistence; revocation or epoch change during inference prevents persistence.
- Data is classified by content and lineage, not table name. Copying raw text into a “derived” table does not make it derivative.
- Policy decisions are deterministic for a captured input and policy bundle.
- The application stores the decision metadata, not prompt/review/model-response bodies, as evidence.
- A feature flag can narrow a permitted capability. It can never broaden a denied capability.

Normative source inputs are the [Google response and disposition](../google-business-profile-ai-policy-response-2026-07-14.md), Google's [Business Profile API policies](https://developers.google.com/my-business/content/policies), and the approved internal privacy/provider/routing records.

## 3. Canonical data classes

```ts
type SourceDataClass =
  | 'raw_source_content'
  | 'transient_inference_material'
  | 'derived_review_metadata'
  | 'ai_reply_draft'
  | 'published_reply_mirror'
  | 'control_evidence'
```

| Class                          | Allowed contents                                                                                                      | Forbidden contents or behavior                                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `raw_source_content`           | Canonical Google review/reply fields inside the review lifecycle boundary                                             | Copies in jobs, events, ordinary logs/traces, notifications, activity text, inbox projections, read-model caches, or test dumps |
| `transient_inference_material` | Minimized, redacted operation input/output during one approved invocation                                             | Durable application storage; general debug logging; use for provider training                                                   |
| `derived_review_metadata`      | Property-scoped sentiment, score, category, theme, trajectory, summary facts plus non-content versions and quality    | Review excerpts, exact ratings/replies, reviewer identity, Google IDs, reversible fingerprints, or cross-property combination   |
| `ai_reply_draft`               | Manager-visible generated reply candidate and its provenance until publish/discard/expiry                             | Automatic publication; treating it as a durable style corpus; embedding raw reviewer identity                                   |
| `published_reply_mirror`       | Reply text re-fetched from Google and served as raw source content                                                    | Indefinite retention merely because RepKey originally drafted it                                                                |
| `control_evidence`             | Internal IDs, policy/deployment/region/consent/redaction versions, timestamps, counts, decision/error class, actor ID | Review/prompt/reply text, reviewer identity, provider raw bodies, secrets, or reversible content hashes                         |

If a value matches more than one class, the most restrictive class applies.

## 4. Capability registry

The initial registry is intentionally narrower than all technically possible operations.

```ts
type SourceCapability =
  | 'review.sync'
  | 'review.serve_raw'
  | 'review.reply.publish_manual'
  | 'ai.review.analyze'
  | 'ai.reply.draft'
  | 'ai.property.trends'
  | 'ai.review.historical_backfill'
  | 'ai.reply.few_shot_examples'
  | 'ai.cross_property.summary'
  | 'ai.reply.auto_publish'
  | 'workforce.review_gamification'

type CapabilityRule = Readonly<{
  decision: 'allow' | 'allow_if' | 'deny'
  requiredControls: readonly ControlId[]
  allowedInputClasses: readonly SourceDataClass[]
  allowedOutputClasses: readonly SourceDataClass[]
  rationale: string
}>
```

| Capability                      | Initial decision | Required boundary                                                                                                                         |
| ------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `review.sync`                   | `allow_if`       | Authorized connection/property; raw lifecycle; target/source epoch valid; bounded canonical storage                                       |
| `review.serve_raw`              | `allow_if`       | Authorized property reader; content not expired/deleting; no prohibited cache copy                                                        |
| `review.reply.publish_manual`   | `allow_if`       | Authorized manager; explicit current command; idempotency; current raw review; final text; Google result/audit                            |
| `ai.review.analyze`             | `allow_if`       | One property; opt-in; approved deployment/region; PII redaction; policy-valid raw input; approved schema                                  |
| `ai.reply.draft`                | `allow_if`       | Same controls plus direct manager request and draft-only output                                                                           |
| `ai.property.trends`            | `allow_if`       | Inputs belong to exactly one Business Profile; opt-in; bounded policy-valid inputs; derived-only persisted output                         |
| `ai.review.historical_backfill` | `allow_if`       | Same-property raw inputs remain policy-valid; explicit backfill capability; bounded/resumable job; retain only allowed derivatives        |
| `ai.reply.few_shot_examples`    | `allow_if`       | Conservative rule: same property, current policy-valid reply mirrors only, no durable style corpus; separately enabled                    |
| `ai.cross_property.summary`     | `deny`           | Outside the submitted architecture and current product decision                                                                           |
| `ai.reply.auto_publish`         | `deny`           | Google response requires manager review and separate manual publication                                                                   |
| `workforce.review_gamification` | `deny`           | Review/rating/count/click/scan/named-mention/public-conversion inputs cannot drive staff goals, badges, rankings, or employment decisions |

The historical-backfill and few-shot rules are conservative internal interpretations because Google's response did not answer those items individually. They must remain separately switchable and may not inherit permission merely from `ai.review.analyze`.

## 5. Policy bundle

The implementation may refine names, but it must preserve these semantics:

```ts
type SourceContentPolicy = Readonly<{
  policyId: 'google-business-profile/2026-07-14.v1'
  source: 'google_business_profile'
  status: 'draft' | 'active' | 'retired'
  effectiveAt: Date
  evidenceRefs: readonly string[]

  rawContent: {
    maximumCacheAgeMs: number // 30 days
    refreshDueAfterMs: number // initial operational target: 25 days
    expiryBasis: 'latest_successful_authorized_source_fetch'
    missedExpiryAction: 'deny_and_purge'
    canonicalOwner: 'review'
  }

  derivedMetadata: {
    allowed: true
    retentionPolicyId: string
    prohibitedFields: readonly string[]
    propertyScopeRequired: true
  }

  rules: Readonly<Record<SourceCapability, CapabilityRule>>
  controls: Readonly<Record<ControlId, ControlRule>>
}>
```

The active bundle is immutable. A policy change creates a new identifier and effective time; it does not edit historical meaning. The old bundle remains available to interpret historical control evidence, but retired policy cannot authorize new work.

## 6. Required evaluation input

```ts
type PolicyEvaluationInput = Readonly<{
  operationId: string
  capability: SourceCapability
  source: 'google_business_profile'
  inputClasses: readonly SourceDataClass[]
  requestedOutputClass: SourceDataClass

  organizationId: string
  propertyId: string
  sourceEpoch: number
  rawContentState?: {
    internalReviewId: string
    lastSuccessfullyFetchedAt: Date
    expiresAt: Date
    deletionState: 'active' | 'deleting' | 'deleted'
  }

  actor?: {
    userId: string
    authorizationDecisionId: string
  }

  merchantOptIn?: {
    state: 'enabled' | 'disabled' | 'suspended' | 'revoked'
    enablementEpoch: number
    noticeVersion: string
    capabilities: readonly SourceCapability[]
  }

  processingProfile?: {
    region: 'us' | 'europe' | 'global' | 'unresolved'
    routingPolicyVersion: number
  }

  providerDeployment?: {
    deploymentId: string
    region: 'us' | 'europe' | 'global'
    approvalVersion: string
    approvalExpiresAt: Date
  }

  redaction?: {
    profileId: string
    language: string
    status: 'passed' | 'unsupported' | 'failed' | 'review_required'
  }

  now: Date
}>

type PolicyEvaluation =
  | {
      allowed: true
      decisionId: string
      policyId: string
      controlsSatisfied: readonly ControlId[]
      evidence: PolicyEvidence
    }
  | {
      allowed: false
      decisionId: string
      policyId?: string
      reason:
        | 'unknown_policy'
        | 'capability_denied'
        | 'input_class_denied'
        | 'output_class_denied'
        | 'source_expired'
        | 'source_deleting'
        | 'source_epoch_changed'
        | 'actor_not_authorized'
        | 'merchant_opt_in_missing'
        | 'capability_not_opted_in'
        | 'enablement_epoch_changed'
        | 'region_unresolved'
        | 'provider_deployment_unapproved'
        | 'region_mismatch'
        | 'redaction_not_approved'
        | 'control_evidence_stale'
    }
```

The decision output is safe for operational logs because it contains no source or prompt content. `decisionId` is unique; repeated evaluation may generate a new decision but the operation's durable result must retain the final successful decision ID.

## 7. Evaluation order

For external inference, evaluate in this order so denied work fails before content leaves the canonical boundary:

1. Resolve the active policy bundle and exact capability.
2. Verify organization/property/source ownership, source epoch, and current authorization.
3. Verify the raw source is active and has not reached `expiresAt`.
4. Verify property Merchant AI Opt-in, allowed capability, notice version, and enablement epoch.
5. Resolve the Property Processing Profile.
6. Resolve one currently approved Provider Deployment in the same processing cell.
7. Minimize and redact input using a profile approved for the detected language.
8. Re-evaluate the decision immediately before invocation with the redaction result.
9. Invoke the provider with content logging/retention/training controls applied.
10. Validate and scan output.
11. Re-read opt-in, policy, source epoch, deletion state, and deployment approval before persistence.
12. Persist only the allowed output class and content-free control evidence.

An interactive reply request may return a graceful capability-unavailable error. A background analysis job records a terminal policy skip. Neither becomes a retry storm unless the denial class is explicitly transient, such as a temporarily unavailable approved regional deployment.

## 8. Raw-cache clock

Until narrower written clarification exists, RepKey uses this conservative rule:

- `lastSuccessfullyFetchedAt` changes only when Google returns and RepKey validates the current source representation through an authorized API request.
- `refreshDueAt = lastSuccessfullyFetchedAt + 25 days` is an internal reliability target, not extra permitted retention.
- `expiresAt = lastSuccessfullyFetchedAt + 30 days` is the hard serving/processing boundary.
- A failed fetch, local read, job retry, local copy, database update, backup, restore, or provider call never moves any of those timestamps.
- At or after `expiresAt`, raw serving and inference are denied immediately and the purge workflow is due. There is no post-expiry serving grace.
- A restore recomputes policy eligibility against current time before traffic is allowed.

If Google later clarifies that a successful fetch does not restart the applicable cache period, a new policy version must adopt the narrower rule and migrate/purge affected rows before activation.

## 9. Enforcement points

| Boundary                        | Required enforcement                                                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Google adapter                  | Authorized source fetch, strict response validation, no raw body logs, successful-fetch evidence                                         |
| Review command store            | Canonical raw copy, source/fetch/expiry fields, transactional events, no expired serving                                                 |
| Server use case                 | Tenant/property authorization, source-policy decision, capability-specific errors                                                        |
| Job producer                    | Identifier-only payload, source and enablement epochs, deterministic idempotency                                                         |
| Worker                          | Reload current state and policy; do not trust payload authorization/consent/content                                                      |
| AI adapter                      | Final quota + policy/deployment/region/redaction check; adapter has no Google reply-publish capability                                   |
| Result repository               | Output-class validation, versions/evidence, property scope, uniqueness/idempotency                                                       |
| Dashboard/read model            | Derived-only permitted schema; raw lookup remains bounded and lifecycle-controlled                                                       |
| Lifecycle coordinator           | Stop new work, neutralize pending jobs, purge registered participants, record content-free completion                                    |
| Logs/traces/metrics/error tools | Deny prompt/review/reply/reviewer/provider-body content; use low-cardinality decision/result metadata                                    |
| Backup/restore                  | Do not treat backup as a retention extension; run current-expiry and deletion-ledger processing before restored data becomes serviceable |

## 10. Persistence and audit

Store one content-free invocation/control record containing:

- operation and idempotency IDs;
- organization/property and opaque internal subject IDs;
- capability and input/output data-class names;
- policy, source epoch, opt-in notice and enablement epoch;
- routing-policy, processing region, provider deployment/approval, model, prompt/schema, and redaction-profile versions;
- timestamps, token counts, cost estimate, latency, result/error class, and retry relation; and
- actor/authorization decision for interactive actions.

Do not store raw prompts, raw responses, redacted prompts, review excerpts, exact ratings, reviewer names, Google review IDs, authentication headers, or provider error bodies in this record.

## 11. Verification requirements

### Unit/property tests

- Every denied capability and unknown enum/value fails closed.
- All required controls are independently omitted and produce the expected reason.
- Expiry boundaries cover just before, exactly at, and after expiry.
- Local writes cannot extend source timestamps.
- Mismatched property, source epoch, enablement epoch, deployment region, or policy version denies.
- Feature flags can turn permitted work off but cannot turn denied work on.
- Decision serialization contains no fixture marker drawn from raw content.

### Integration tests

- API, direct use-case, worker, scheduler, replay/backfill, and adapter paths all use the same evaluator.
- A queued job is neutralized after opt-in revocation, source disconnect, region change, or policy retirement.
- A policy/consent change during provider execution prevents result persistence.
- Expired content cannot appear through inbox, cache, notification, activity, dashboard, export, error monitoring, or restored backup.
- Manual reply publication works without an AI capability and AI reply drafting cannot invoke publication.

### Release proof

The candidate release records the exact active policy bundle hash/identifier, test report, production/staging configuration digest, and sample metadata-only decisions. See the [release-evidence index](ai-release-evidence-index.md).

## 12. Open decisions that do not broaden the baseline

- Exact Google refresh-clock semantics: continue conservative successful-fetch rule until clarified.
- Final derived-metadata retention: use the proposed defaults in the lifecycle standard only after product/privacy approval.
- Durable previous-reply examples: remain disabled as a corpus; current-cache examples require a separate capability.
- Historical backfill: permitted only through its explicit capability and phase-specific load/quota plan.
- Policy service location/package name: decide during PRE17 implementation; semantics above are fixed.
