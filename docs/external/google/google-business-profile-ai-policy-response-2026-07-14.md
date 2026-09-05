# Google Business Profile AI Policy Response and Disposition

**Status:** Written Google Business Profile API Support response received; internal policy translation required  
**Response supplied:** 2026-07-14  
**Submitted by:** Bozhidar Denev  
**Google responder:** Sudeepthi, Google Business Profile API Support  
**Support case ID:** Not supplied in the copied response; attach it when available  
**Applies to:** The architecture described in the linked request, not an unrestricted permission for other processing

## 1. Evidence set

- [Submitted request](google-business-profile-ai-policy-clarification.md)
- [Submitted PDF attachment](attachments/reputation-key-google-ai-policy-clarification.pdf)
- The original email, full headers, sender address, date/time, and support case should be retained outside the repository's public history or in the approved compliance-evidence store.

The verbatim response below was supplied by the product owner. Repository maintainers have not independently authenticated the email headers.

## 2. Verbatim response

> Hi Bozhidar Denev,
>
> Thank you for contacting the Google Business Profile API Support.
>
> Based on the information you've shared, your proposed architecture is generally aligned with Google Business Profile API policies. Processing reviews on a per-property basis, removing reviewer identity before sending data to an external AI model, and requiring a manager to review and manually publish replies are all consistent with the recommended approach.
>
> Regarding your specific questions:
>
> **Manipulation and aggregation:** Property-level analysis, such as sentiment, themes, and trend summaries, is permitted provided the insights are generated independently for each Business Profile and are not used to create misleading or combined ratings across multiple unrelated properties.
>
> **Storage and caching:** Raw review content (including review text, star ratings, reviewer information, and replies) is subject to the Business Profile API caching requirements and should be refreshed or removed in accordance with the applicable 30-day policy. However, derived information such as sentiment labels, scores, categories, themes, and summary insights is considered derivative metadata and is not subject to the same 30-day retention limitation.
>
> **External AI models:** Sending review text to an external AI provider is permitted, provided appropriate privacy safeguards are in place. This includes removing personally identifiable information before transmission, ensuring the provider does not use the submitted data for model training, minimizing data retention, and complying with applicable regional privacy regulations.
>
> **Authorization and publishing:** Using the OAuth 2.0 Web Server flow with the appropriate Business Profile scope, obtaining merchant opt-in before enabling AI features, and requiring a separate manual publish action after a manager reviews or edits the AI-generated response are all consistent with recommended practices. Automated posting of AI-generated replies without human review is not supported.
>
> Hope this helps!
>
> Sincerely,  
> Sudeepthi.

## 3. Resolved disposition

| Capability/issue                                   | Disposition for the submitted architecture                                                                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-review sentiment, category, and priority/score | Permitted per property, subject to the privacy/provider/opt-in controls below.                                                                                               |
| Per-property themes, trends, and summaries         | Permitted when generated independently for one Business Profile. No cross-property prompt, report, rating, or summary.                                                       |
| Derived metadata retention                         | Sentiment labels, scores, categories, themes, and summary insights are not subject to the raw-content 30-day limit. RepKey still needs a product/privacy retention schedule. |
| Raw Google review content                          | Review text, star rating, reviewer information, and replies must be refreshed or removed according to the applicable 30-day cache policy.                                    |
| External AI provider                               | Permitted after PII removal, no-training assurance, minimum provider retention, and applicable regional/privacy controls.                                                    |
| AI reply draft                                     | Permitted with merchant opt-in and manager review/edit.                                                                                                                      |
| Reply publication                                  | Must be a distinct manual manager action. Automatic AI reply publication is not supported.                                                                                   |
| OAuth                                              | OAuth 2.0 Web Server flow with the appropriate Business Profile scope is aligned with the recommended approach.                                                              |

This satisfies the external written-clarification gate for the described Phase 17 and per-property Phase 18 design. It does not complete the internal implementation gate: ADR 0031, executable source policy, provider review, merchant consent, raw-content lifecycle, PII redaction, regional routing, and release evidence remain required.

## 4. Executable policy baseline

ADR 0031 and `SourceContentPolicy` should encode at least the following versioned decisions:

| Capability                             | State                                        | Conditions                                                                                                                                                                |
| -------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gbp.ai.per_review_analysis`           | `allowed_conditionally`                      | One property; merchant opt-in; PII removed; approved no-training provider/region; content-safe logs.                                                                      |
| `gbp.ai.reply_draft`                   | `allowed_conditionally`                      | Same controls plus authenticated manager request; draft/edit only.                                                                                                        |
| `gbp.reply.auto_publish`               | `denied`                                     | No automated publish path. A distinct manager action is mandatory.                                                                                                        |
| `gbp.ai.property_trends`               | `allowed_conditionally`                      | Inputs and outputs belong to one Business Profile; no cross-property combination.                                                                                         |
| `gbp.ai.cross_property_summary`        | `denied_for_current_product`                 | Outside the submitted design and unnecessary for the accepted product direction.                                                                                          |
| `gbp.raw_content.cache`                | `allowed_conditionally`                      | Secure, limited, refreshed or removed under the applicable 30-day policy.                                                                                                 |
| `gbp.derived_metadata.persist`         | `allowed_conditionally`                      | No raw content/PII embedded; property scoped; product/privacy retention and deletion apply.                                                                               |
| `gbp.ai.historical_backfill`           | `allowed_by_general_disposition_with_caveat` | Process authorized per-property reviews while raw content remains policy-valid; retain only permitted derived metadata. The response did not answer this item separately. |
| `gbp.ai.reply_few_shot`                | `not_explicitly_confirmed`                   | Conservative default: only approved same-property replies within the valid raw-content cache window; do not create a durable raw-reply style corpus.                      |
| `gbp.review_solicitation_gamification` | `denied_by_separate_policy`                  | Review clicks, request scans, review volume/rating, named mentions, and public-review conversion never drive staff goals, badges, or leaderboards.                        |

Unknown capability or policy-version lookup failure must fail closed for new AI processing while leaving non-AI review management available.

## 5. Data separation and lifecycle

### Raw-content class

Includes review text, star rating, reviewer name/photo/identifiers, Google review identifier, reply text, and any prompt/few-shot body that reproduces those values.

- Store only in the source-content/cache boundary.
- Record `first_fetched_at`, `last_refreshed_at`, `refresh_due_at`, `expires_at`, policy version, property/region, and deletion state.
- Refresh or remove through a tested, observable process; no convenience copy in inbox, jobs, logs, traces, audit, notifications, analytics, or provider batch files.
- Provider requests and batch objects use the shortest approved retention and are deleted independently of application caching.

### Derived-metadata class

Includes sentiment label/confidence, category, priority/score, theme, trajectory, and property summary insight that does not reproduce raw content or PII.

- Store separately from raw review rows and payloads.
- Retain property, analysis/model/prompt/schema/policy version, processing region/time, quality status, and an opaque internal lineage reference.
- Do not preserve Google review IDs, excerpts, exact ratings, replies, names, or reversible content fingerprints in long-lived derivative records without a separately approved need.
- When the raw row expires, per-review UI association may disappear; durable daily/property derived facts and reports remain according to the approved product/privacy schedule.
- Disconnect/deletion still stops new work and applies the documented customer/privacy deletion policy to derivative data; “not subject to 30 days” does not mean “retain forever.”

## 6. Privacy and provider conditions

“Removing reviewer identity” is not limited to dropping structured profile fields. Review text can itself contain names, email addresses, telephone numbers, booking references, or other identifiers. Before external inference:

1. Remove structured reviewer identity and unneeded provider metadata.
2. Run bounded PII detection/redaction over free text, with language coverage and false-positive/false-negative evaluation.
3. Send only fields required by the operation; property context must not contain unrelated guest/staff PII.
4. Contract/configure the provider not to train on submitted data and minimize provider retention.
5. Route through the property's approved US/EU/other processing profile with no silent global fallback.
6. Keep prompt/response bodies out of ordinary application/provider invocation logs.
7. Record metadata-only processing evidence: property, operation, model/deployment, region, policy/prompt/schema version, token/cost/latency, result/error class, and consent version.

Provider marketing statements are insufficient. Preserve the applicable contract/DPA, product configuration, retention/no-training documentation, subprocessor/region evidence, and a dated verification checklist.

## 7. Merchant consent and reply control

- AI is off by default per property.
- An authorized merchant administrator enables it after seeing the data flow, provider/subprocessor, purposes, retention, regions, limitations, and how to disable it.
- Persist property, actor, policy/notice version, enabled capabilities, provider/region, and timestamp.
- Revocation stops new AI jobs immediately; pending work checks the current consent epoch before provider invocation and before persistence.
- Reply generation and reply publication are separate commands, permissions, idempotency keys, activity/audit events, and UI actions.
- The AI context returns a draft only. It must have no Google publish credential/port or generic side effect that can publish.

## 8. Remaining clarification and internal decisions

Google's response did not individually address:

1. The exact refresh semantics that reset/extend the 30-day raw-content cache window.
2. Use of up to three previously published replies as durable style examples.
3. The optional historical backfill as a separately named capability.
4. Backup/log treatment beyond the raw-content caching requirement.

These do not block Phase 17/18 planning if RepKey adopts the conservative baseline above. Send a follow-up only if the product requires broader behavior.

Internal decisions still required before implementation planning closes:

- provider and deployment per region;
- PII-redaction method and quality threshold;
- raw refresh/removal schedule and backup behavior;
- derived metadata/report retention;
- merchant consent/withdrawal UX;
- supported languages and human-review safeguards;
- quality, latency, quota, and cost thresholds.

## 9. Change-control rule

This disposition applies to the exact request Google reviewed. Re-submit or obtain counsel/policy review before enabling cross-property analysis, automatic reply publishing, provider training, materially longer provider content retention, new data categories, or employment/worker scoring. Recheck the public GBP policies and preserve the applicable support response at every material release.
