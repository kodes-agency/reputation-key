# Arc 7 AI Platform Research: GBP Compliance, Providers, Packaging, and Delivery

**Researched:** 2026-07-14  
**Scope:** Decision input for Phases 17–18; Google Business Profile compliance, provider/deployment choice, quota packaging, and the current repository's delivery constraints.  
**Sources:** Official Google, OpenAI, Anthropic, Microsoft, AWS, Mistral, vLLM, and BullMQ documentation plus the current repository.  
**Status:** Research and engineering guidance, updated after Google's written response; not legal advice and not yet an implementation plan.  
**Google disposition:** [Per-property AI architecture conditionally permitted](google-business-profile-ai-policy-response-2026-07-14.md)

## Decision-ready recommendation

1. **Google has conditionally cleared the submitted per-property architecture.** Its written support response permits independently generated per-property sentiment, scores, categories, themes, trends, and summaries; external AI processing; and manager-reviewed reply drafting. Raw review text, ratings, reviewer information, and replies remain under the applicable 30-day refresh/removal policy, while derived metadata is not subject to that same limit.
2. **Translate the response into code before release.** ADR 0031 and `SourceContentPolicy` must enforce per-property isolation, raw/derived data separation, PII removal, provider no-training/minimum-retention controls, property-region routing, merchant opt-in, and a separate manual reply-publication command. Unknown policy state fails closed for AI without breaking non-AI review management.
3. **The external policy gate is resolved; PRE17 remains the internal readiness gate.** Phase 17/18 planning may proceed when requested, but production AI waits for the lifecycle, consent, provider, reliability, privacy, and evaluation evidence—not another general Google approval. Historical backfill and durable reply few-shot examples retain narrower caveats because Google did not answer them individually.
4. **Keep `AIProvider` portable, but run one production provider initially.** Evaluate OpenAI direct, Vertex AI EU, and Mistral EU on a frozen multilingual fixture set; include Anthropic as a quality benchmark. Mistral is a credible EU-native option, OpenAI has the strongest structured-output ergonomics, and Vertex has the clearest Google Cloud EU deployment story. Bedrock is the strongest governance alternative when explicit no-retention/IAM enforcement is worth extra operations.
5. **Do not invent Free/Pro/Enterprise plans inside Arc 7.** Start with internal per-property fair-use limits and an organization safety cap; measure real usage and quality; then expose a per-property included allowance or AI credit add-on. Store generic entitlements so a future billing plan can drive them without changing the AI context.
6. **Preserve the original reliability design.** Quota authorization needs atomic reservation and settlement inside the provider boundary. BullMQ jobs and settlements must be idempotent. The current in-process event handoff needs reconciliation or an outbox to make the 60-second gate credible.

The recommended sequencing is therefore:

```text
now
  -> preserve Google response and encode ADR 0031/source policy
  -> complete PRE17 raw-content lifecycle, regions, durable jobs, and observability
  -> run provider bake-off with synthetic/anonymized fixtures
  -> choose and verify one no-training, minimum-retention deployment per region
  -> plan and implement Phase 17 with merchant opt-in and manual publish only
  -> launch Phase 18 per property only; no cross-property prompt/report/summary
```

## Evidence labels

- **Published rule/fact** means an official source directly supports the statement.
- **Engineering inference** means the conclusion follows from published behavior but is not vendor assurance.
- **Written support disposition** means Google API Support addressed the submitted architecture directly; it must not be generalized beyond that scope.
- **Unresolved** means neither public material nor the written response answers the narrower behavior.

Provider prices below are current on the research date, in USD per 1 million text tokens before tax. Catalogs, promotional rates, regions, and privacy programs change; revalidate them before implementation and store price schedules with effective dates.

# Part I — Google Business Profile compliance

## 0. Written support disposition received

Google Business Profile API Support stated that the submitted architecture is generally aligned with policy. It permits per-property sentiment, themes, trend summaries, derived scores/categories/insights, external AI processing, and manager-reviewed reply drafting subject to the conditions recorded in the [response and executable disposition](google-business-profile-ai-policy-response-2026-07-14.md).

The response resolves the main manipulation/aggregation, derived-retention, external-provider, OAuth/merchant-opt-in, and manual-publish questions. It does not waive the public GBP terms: raw content remains under the applicable 30-day refresh/removal policy; PII must be removed before external processing; providers must not train on the data and must minimize retention; applicable regional privacy rules still apply; and automatic AI reply publishing is unsupported.

## 1. Controlling rules

Google's GBP terms make the Business Profile Additional Terms, GBP API policies, and general Google API terms collectively applicable, with product-specific terms controlling conflicts. ([GBP API terms](https://developers.google.com/my-business/content/terms), [Google APIs Terms](https://developers.google.com/terms/))

The material rules are:

- An API client may create, manage, and report on listings it owns or is authorized to manage. Uses outside the policy scope are prohibited. ([GBP API policy](https://developers.google.com/my-business/content/policies))
- A third party responding to a client's reviews needs authorization. Google also prohibits automating or triggering review replies or other changes without the user's prior specific and express consent. ([GBP reviews and automated use](https://developers.google.com/my-business/content/policies))
- API Content cannot be prefetched, cached, indexed, or stored outside the Business Profile project except in limited amounts to improve project performance. Stored Content must be secure, temporary for no more than 30 calendar days, and cannot be manipulated or aggregated. ([GBP Content storage](https://developers.google.com/my-business/content/policies#content-storage))
- API users must disclose how Google user data is accessed, used, stored, shared, and deleted. Where the additional Limited Use rules apply, they expressly cover raw, aggregated, anonymized, and derived data; certain processor transfers for prominent user-facing features require consent. ([Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy))
- The general API terms do not grant ownership of returned content and restrict modifying, creating derivative works from, or conveying it unless the content owner or law permits it. ([Google APIs Terms—Content](https://developers.google.com/terms#section_5_content))
- Google may audit the product, require a live-equivalent demo within seven days, and disable a project for violations. ([GBP enforcement](https://developers.google.com/my-business/content/policies))

I found no official public text that specifically approves third-party sentiment analysis, priority scoring, LLM reply drafting, theme extraction, or custom trend summaries from GBP review content.

## 2. What the public text did not define before the support response

The original public-doc research correctly identified the following ambiguities. Google's written response now resolves the derived-data, per-property analysis, external-processor, OAuth/opt-in, and manual-publish questions for the submitted design. The exact cache-refresh clock, durable few-shot reply corpus, historical-backfill wording, and backup/log treatment remain conservative implementation decisions:

- Whether every review field—text, rating, reviewer metadata, reply—is “Content.”
- Whether sentiment, priority, themes, and summaries become Content or are separately usable derived data.
- Whether transient inference is “manipulation” when nothing is persisted.
- Whether “project” means the Google Cloud project, the logical API client/product, or something else.
- Whether an LLM processor is “outside” the project.
- When the 30-day clock begins, whether an edit creates a new content version, and whether refetching resets anything.
- Whether derived output may survive deletion of the source review.
- Whether using Vertex AI or another Google service in the same Cloud project changes the answer.

No-training, minimum retention, regional processing, deleting prompt bodies, and 30-day raw-content controls are now conditions of the permitted design, not substitutes for permission. The written response supplies the permission only for the submitted per-property scope.

## 3. A pre-existing SaaS-project question

Google's policy says agencies, end-clients, or other third parties cannot use a provider's Business Profile project in a way that avoids obtaining their own project; end users must manually sign in, and the policy gives licensed listing-management software as an example of prohibited indirect programmatic access. It also says the provider's **own** programmatic use is not restricted by this clause. ([Automated use of a Business Profile project](https://developers.google.com/my-business/content/policies))

The boundary between “the tool provider's own use” and “indirect access by end-clients” is not clear enough to infer approval for this app's architecture:

- The app has one configured `GOOGLE_CLIENT_ID`/secret used to connect end-client organizations. ([integration build](../../src/contexts/integration/build.ts), [OAuth use case](../../src/contexts/integration/application/use-cases/get-google-auth-url.ts))
- End-clients manually authorize the `business.manage` scope, but background sync and notifications then operate programmatically.
- The product exposes review management through its own UI rather than handing clients a raw GBP automation API. That is a favorable distinction, but Google does not publish a precise safe boundary.

**Updated disposition:** Google's response expressly says the OAuth 2.0 Web Server flow with the appropriate Business Profile scope is aligned with the recommended approach. Continue to test tenant authorization, merchant opt-in, disconnect, scope, and manual publish; do not interpret this as approval for exposing a raw automation API.

## 4. Retention start point and the current implementation

Google's response says raw review content should be refreshed or removed under the applicable 30-day policy, but it does not define the precise cache-clock reset semantics.

The repo currently computes:

```text
expires_at = reviewed_at + 30 days
```

and immediately expires an old review imported today. ([review retention rule](../../src/contexts/review/domain/rules.ts), [review context](../../src/contexts/review/CONTEXT.md))

This is based on review publication rather than RepKey's cache lifecycle, so an old review imported today expires immediately even though it was just fetched.

Use the response's refresh-or-remove wording as the conservative executable baseline:

```text
first_received_at = first API receipt of the review lineage
last_refreshed_at = latest successful API retrieval of the cached content/version
refresh_due_at <= last_refreshed_at + 25 calendar days
expires_at = last_refreshed_at + 30 calendar days
if refresh does not succeed by expires_at -> remove raw content and all raw copies
```

Preserve `first_received_at` for lineage and refresh evidence. A successful refresh may extend the cache window; a scheduler must not extend it merely by updating a timestamp locally. Store permitted derived metadata separately so it can follow the product/privacy retention schedule after raw content is removed.

## 5. Supported reporting does not clearly include review NLP

Google's third-party policy explicitly discusses Business Profile performance reports and permits some aggregation of GBP performance data with other platforms when Google-specific reporting remains readily accessible. It forbids sharing or comparing one customer's GBP-specific data with another customer. ([Business Profile third-party policy](https://support.google.com/business/answer/7353941))

This supports charts based on documented Performance API metrics such as impressions, calls, website clicks, bookings, and orders. ([GBP API FAQ](https://developers.google.com/my-business/content/faq)) Google's later written response separately permits sentiment trajectories and themes when independently generated for one Business Profile.

The user's decision to keep Phase 18 per property matches the permitted scope and avoids organization summaries/cross-property blending. Cross-property ratings, prompts, theme extraction, comparisons, and summaries remain outside the current disposition.

## 6. Feature risk map

This is a practical risk classification, not legal advice.

| Capability                                    | Current disposition | Practical reading                                                                                                             |
| --------------------------------------------- | ------------------: | ----------------------------------------------------------------------------------------------------------------------------- |
| Sentiment/category on direct guest feedback   |             Allowed | Outside GBP terms; ordinary privacy/AI rules still apply.                                                                     |
| Raw GBP review storage                        |         Conditional | Secure, limited cache; refresh or remove under the applicable 30-day policy.                                                  |
| Per-review sentiment/category/priority        |         Conditional | Permitted per property after PII removal, merchant opt-in, approved provider/region, and content-safe logging.                |
| Retained derived sentiment/priority metadata  |         Conditional | Not subject to the raw 30-day limit; must exclude raw content/PII and follow product/privacy retention.                       |
| Manager-requested reply draft                 |         Conditional | Permitted with merchant opt-in and human review/edit.                                                                         |
| Manual preview/edit/publish                   |            Required | Publication is a separate manager action with authorization and idempotency.                                                  |
| Automatic AI reply publishing                 |              Denied | Google's response says it is unsupported.                                                                                     |
| Previous GBP replies as few-shot examples     |             Caution | Not answered separately; use only same-property replies in a valid raw-cache window unless further clarification allows more. |
| Daily per-property themes/trajectories        |         Conditional | Permitted independently per Business Profile; no cross-property prompt/report/rating/summary.                                 |
| Per-property sentiment/priority distributions |         Conditional | Permitted derivative property analysis; retain only non-content metadata.                                                     |
| Historical per-property analysis              |             Caution | Supported by the general disposition but not separately answered; process valid cached inputs and retain derivatives only.    |
| Cross-property themes/ratings/summaries       |        Out of scope | Outside the submitted product and expressly avoided.                                                                          |
| GBP Performance API metrics                   |             Allowed | A separately documented reporting category.                                                                                   |

## 7. Actual-review-first launch path

```text
google_business_profile
  raw content refreshed or removed under the 30-day cache policy
  per-review sentiment/priority/category after PII removal and merchant opt-in
  manual reply publication with action-specific consent
  per-property trends/summaries with no cross-property combination
  retained derived metadata separated from raw review content

places_official_summary
  optional official fallback only where available
  show mandatory disclosure/attribution/links
  do not materialize a history

if implementation cannot satisfy privacy/provider/region/cache conditions
  keep AI capability off without disabling non-AI review management
  do not silently route content to another region/provider
  do not relabel guest feedback as the same product
```

For replies, the best consent trail is:

1. The manager clicks **Generate draft** after a concise AI-processing disclosure.
2. The server returns and persists an editable draft with its provenance.
3. The manager reviews/edits it.
4. A separate **Publish to Google** action records user, time, review, and final text.
5. The app never silently generates and publishes.

Google's own guidance recommends concise, professional, relevant replies and warns against revealing private information. ([Google review reply guidance](https://support.google.com/business/answer/3474050))

## 8. Transient, rolling, self-hosted, and export variants

| Variant                                           | What it improves                                           | What it does not resolve                                                                                             |
| ------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Process in memory, persist no raw prompt/response | Minimizes storage and deletion burden                      | Whether inference itself is permitted; processor transfer                                                            |
| Delete source and derivations within 30 days      | Bounds retention                                           | The explicit non-manipulation/non-aggregation language                                                               |
| Use a ZDR provider                                | Vendor does not retain eligible calls                      | Google permission, project boundary, app persistence                                                                 |
| Self-host in the EU                               | Removes model-vendor transfer                              | Manipulation/aggregation and app retention                                                                           |
| Customer uploads a Google export                  | File is not literally delivered through this app's GBP API | Google does not grant an explicit arbitrary-analysis license; reviewer rights and anti-circumvention concerns remain |
| Customer uploads first-party CRM/feedback data    | Avoids GBP API Content rules                               | It is a different product and not the selected fallback for this Arc; ordinary privacy duties still apply            |

Google confirms that businesses can export applicable account data and that users can share Takeout downloads with third-party apps. ([Business Profile Additional Terms](https://support.google.com/business/answer/9292476), [Google Takeout](https://support.google.com/accounts/answer/3024190)) It does not say that such an export authorizes indefinite storage or custom review analysis. Public scraping is not a safe substitute. ([Google Maps Additional Terms](https://maps.google.com/help/terms_maps/))

## 9. Official Places AI review summaries

On 2026-07-10 Google documented an official Places API `reviewSummary`: a Google-generated high-level summary based on reviews and sentiment. ([AI-powered review summaries](https://developers.google.com/maps/documentation/places/web-service/review-summaries))

It is a useful fallback for a current property summary because Google supplies the aggregation under a documented display route. It is not Phase 18 trend detection:

- no custom themes, comparison windows, trajectories, evidence selection, or historical series;
- not guaranteed for every place;
- supported only in listed regions/languages; Bulgaria is not currently listed;
- the complete unmodified summary, “Summarized with Gemini,” Google Maps attribution, review link, reporting link, and about link are required;
- Places Content generally cannot be cached except for narrow exceptions, so fetch for display rather than materializing report history. ([Places policies and attribution](https://developers.google.com/maps/documentation/places/web-service/policies))

## 10. Written validation completed; revalidation path

Use the official [Business Profile APIs support channel](https://developers.google.com/my-business/content/support) from the Cloud project holding/requesting access. The general terms say use beyond documented API limits needs Google's express consent and direct developers to the relevant API team. ([Google API limitations](https://developers.google.com/terms#section_2_using_our_apis))

The architecture request was submitted and Google API Support returned the [written disposition](google-business-profile-ai-policy-response-2026-07-14.md). Preserve the original case/email evidence and provide an implementation-equivalent demo if Google requests one. Re-submit material changes—especially cross-property processing, auto-publication, provider training, broader raw retention, or new data uses—rather than treating the current answer as unrestricted permission.

The submitted questions included:

1. Does “Content” include review text, rating, reviewer metadata, replies, and outputs derived from them?
2. Is this app's single developer project plus individual end-client OAuth/background sync permitted, or must each end-client use a separate GBP API project?
3. May the app send one authorized review to a contracted LLM for sentiment, priority, categorization, or a manager-requested reply draft?
4. Does the answer differ for ZDR processing, self-hosting, Vertex AI/Natural Language, or a provider in the same Google Cloud project?
5. May sentiment/priority survive deletion of the source review?
6. Does the 30-day clock start at review creation, first API receipt, each retrieval, or the latest review edit?
7. May reviews inside a 7/30-day window be aggregated into per-property themes, distributions, trajectories, and summaries?
8. May such a report survive deletion of the raw reviews?
9. May historical reviews be processed once when a property connects?
10. Does explicit merchant consent change any answer, and what proof must be retained?
11. Does independently customer-uploaded Takeout/export data fall outside the API Content rule?
12. What disclosure, attribution, provider-transfer, retention, audit, and deletion rules apply?

OAuth verification should disclose and demonstrate the feature, but OAuth approval is not a waiver of the GBP-specific conditions. Google's separate written response supplies the current per-property disposition. Apply the conservative baseline or seek a narrow follow-up for cache semantics, durable reply examples, historical backfill, or any materially broader design.

# Part II — Provider and deployment options

## 11. Decision matrix

| Option                                                | Structured responses and TypeScript                                                                                                                                                                                                                                                                   | Suggested task split                                                                               | Current indicative price (input/output)                                                                                                                                                        | Training and retention                                                                                                                                                                                                                                                                                                                                                                                                                                                     | EU processing                                                                                                                                                                                                                   | App complexity  |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **OpenAI API**                                        | Strict JSON Schema; official `openai` SDK and Zod helpers. ([Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [SDKs](https://developers.openai.com/api/docs/libraries))                                                                                         | GPT-5.4 nano for sentiment/category; mini for replies/trends                                       | Nano **$0.20/$1.25**; mini **$0.75/$4.50**; full 5.4 **$2.50/$15**. Batch/Flex roughly half. ([Pricing](https://developers.openai.com/api/docs/pricing))                                       | API data is not used for training unless opted in. Default abuse logs may retain content up to 30 days; `store:false` avoids Responses state. Approved ZDR/Modified Abuse Monitoring is eligibility-gated. ([Data controls](https://developers.openai.com/api/docs/guides/your-data), [DPA](https://openai.com/policies/data-processing-addendum/))                                                                                                                        | Eligible projects can use the EU endpoint; newer regional models have a 10% uplift and some metadata remains outside residency scope                                                                                            | **Low**         |
| **Anthropic direct**                                  | Strict JSON Schema via `output_config.format`; official `@anthropic-ai/sdk`. ([Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [TS SDK](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript))                                       | Haiku 4.5 for classification; Sonnet 4.6 for replies/trends                                        | Haiku **$1/$5**; Sonnet 4.6 **$3/$15**; Sonnet 5 promotional **$2/$10** through 2026-08-31, then **$3/$15**. Batch half. ([Pricing](https://platform.claude.com/docs/en/about-claude/pricing)) | Commercial API data is not trained on by default; standard deletion within 30 days; contractual ZDR by request. Batches are not ZDR and retain results up to 29 days. ([Retention](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data), [ZDR](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention))                                                                                                          | Direct API currently offers global or US inference, not EU-only. ([Data residency](https://platform.claude.com/docs/en/manage-claude/data-residency))                                                                           | **Low**         |
| **Gemini Developer API**                              | JSON Schema subset; official `@google/genai`; application validation remains necessary. ([Structured output](https://ai.google.dev/gemini-api/docs/structured-output), [SDKs](https://ai.google.dev/gemini-api/docs/libraries))                                                                       | 3.1 Flash-Lite classification; 3.5 Flash replies/trends                                            | Flash-Lite **$0.25/$1.50**; Flash **$1.50/$9**. Batch/Flex half. ([Pricing](https://ai.google.dev/gemini-api/docs/pricing))                                                                    | Paid tier not used to improve models. Do not use the free tier for reviews. Optional logs default to 55 days if enabled; ZDR is approval-gated and has exceptions. ([Terms](https://ai.google.dev/gemini-api/terms), [logging](https://ai.google.dev/gemini-api/docs/logs-policy), [ZDR](https://ai.google.dev/gemini-api/docs/zdr))                                                                                                                                       | Ordinary Developer API is not an EU-only commitment                                                                                                                                                                             | **Low**         |
| **Vertex AI / Gemini EU**                             | Google GenAI SDK family plus schema support; IAM/service accounts                                                                                                                                                                                                                                     | Same Flash-Lite/Flash split, subject to exact EU availability                                      | Confirm Vertex price/model availability on the chosen EU endpoint; do not assume Developer API parity                                                                                          | Google does not train on customer data without permission; enterprise ZDR and Cloud DPA available. ([ZDR](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/zero-data-retention), [Cloud DPA](https://cloud.google.com/terms/data-processing-addendum/))                                                                                                                                                                                            | Supported Gemini 3.x through the `eu` jurisdictional endpoint stays inside EU member states; global endpoint does not. ([Residency](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/data-residency))   | **Medium**      |
| **Azure OpenAI**                                      | Strict schema; `AzureOpenAI` client; Entra ID recommended. ([Structured Outputs](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/structured-outputs), [TS SDK](https://learn.microsoft.com/en-us/javascript/api/overview/azure/openai-readme?view=azure-node-latest))               | GPT-5.4 nano/mini where deployed                                                                   | Mini Global **$0.75/$4.50**; EU Data Zone approximately **$0.825/$4.95** at research time; SKU/region varies. ([Azure prices API](https://prices.azure.com/api/retail/prices))                 | Prompts/results are not available to OpenAI or used to train models. Stateless inference does not store them, but flagged content can be retained unless approved Modified Abuse Monitoring disables logging/review. ([Privacy](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy), [DPA](https://www.microsoft.com/licensing/docs/view/Microsoft-Products-and-Services-Data-Protection-Addendum-DPA?lang=1))                             | EU Data Zone stays within the EU zone; global deployments/batch do not make that commitment                                                                                                                                     | **Medium-high** |
| **AWS Bedrock**                                       | Converse API validated JSON Schema; official AWS JS SDK. New schemas can take minutes to compile and are cached 24 hours. ([Structured output](https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html))                                                                          | Nova 2 Lite or Claude through Bedrock; benchmark first                                             | Provider/model/region specific; selected batch inference is half-price. ([Pricing](https://aws.amazon.com/bedrock/pricing/))                                                                   | `data_retention_mode:none` explicitly prevents durable request/response storage and provider sharing and can be IAM-enforced. ([Retention controls](https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html))                                                                                                                                                                                                                                             | In-region invocation remains in-region; EU geographic profiles remain inside their documented EU destination list. ([Cross-region inference](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html)) | **High**        |
| **Mistral direct**                                    | Custom schema output; official SDKs. ([Structured Outputs](https://docs.mistral.ai/studio-api/conversations/structured-output))                                                                                                                                                                       | Small 4 for cheap classification and first reply/trend benchmark; Medium 3.5 as quality escalation | Small 4 **$0.15/$0.60**; Large 3 **$0.50/$1.50**; Medium 3.5 **$1.50/$7.50**. Batch half. ([Pricing](https://mistral.ai/pricing/api/))                                                         | API data is not used for training by default; standard inputs/outputs may be held for 30 rolling days for abuse monitoring. Scale-plan ZDR is available for approved stateless endpoints, not batch/stateful products. ([Privacy controls](https://docs.mistral.ai/admin/monitor-comply/privacy-data-controls), [ZDR](https://help.mistral.ai/en/articles/347612-can-i-activate-zero-data-retention-zdr), [Privacy policy](https://legal.mistral.ai/terms/privacy-policy)) | API served from EU data centers by default; enterprise regional controls available. ([Known limitations](https://docs.mistral.ai/resources/known-limitations))                                                                  | **Low**         |
| **Self-hosted Mistral Small 4 or gpt-oss-20b + vLLM** | Open weights behind an OpenAI-compatible vLLM endpoint with constrained generation. ([Mistral pricing/model license](https://mistral.ai/pricing/api/), [gpt-oss](https://openai.com/index/introducing-gpt-oss/), [vLLM server](https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html)) | Classification first; replies/trends only after quality tests                                      | No token fee; dedicated GPU, idle capacity, storage, monitoring, and engineering are the cost                                                                                                  | No model-vendor retention; every GPU host, log, backup, and monitoring system becomes this app's responsibility                                                                                                                                                                                                                                                                                                                                                            | Can be EU-only if the whole stack is EU-scoped                                                                                                                                                                                  | **Very high**   |

No provider publishes a model-level end-to-end latency guarantee strong enough to accept the phase's `<10s` reply target or `60s` review target without measurement from the deployed Railway region.

## 12. Shortlist for this product

Run one bake-off, not seven, using synthetic/anonymized fixtures while the internal provider, privacy, and regional-processing controls are being approved:

1. **OpenAI direct** — best implementation ergonomics and schema tooling; a strong default if EU/ZDR eligibility is available.
2. **Vertex AI EU** — best candidate if formal EU processing boundaries and Google Cloud governance dominate.
3. **Mistral EU** — EU-native, inexpensive, simple, ZDR-capable on Scale, and provides an open-weight migration path; quality must be proven on this domain.
4. **Anthropic direct as a benchmark** — valuable quality comparator, but not the deployment choice if EU-only inference is mandatory.

Azure and Bedrock are deployment/governance alternatives, not extra quality candidates. Choose Azure for Microsoft enterprise procurement; choose Bedrock for explicit enforceable no-retention/geography controls. Self-host only after volume or customer requirements justify a separate GPU platform.

Recommended evaluation set: 100–200 anonymized or synthetic representative examples covering positive, negative, mixed, neutral, sarcasm, rating/text disagreement, short/long text, abuse, each supported language, strong existing replies, and properties with real versus spurious themes. Do not create a long-lived production GBP corpus for evaluation; raw content remains under the refresh/removal policy even though derived metadata may be retained.

Blind-score:

- sentiment/category accuracy and schema validity;
- reply factuality, tone, concision, non-defensiveness, and invented commitments;
- theme coherence, evidence traceability, and false-theme rate;
- safety refusals/errors;
- p50/p95 latency from Railway;
- actual input, output, reasoning, and cached tokens plus estimated cost.

## 13. Architecture alternatives

| Architecture                                | Advantages                                 | Costs/risks                                                                           | Recommendation                                                      |
| ------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Direct single provider                      | Fastest, easiest to observe and contract   | Vendor dependency                                                                     | **Launch choice**, behind a provider-neutral port                   |
| Provider-neutral port with primary/fallback | Easier later migration; resilience         | Two DPAs, inconsistent outputs, double testing, privacy-class downgrade risk          | Implement portability now; keep automatic cross-vendor fallback off |
| Cloud-managed regional deployment           | Strong IAM, residency, enterprise controls | More account/deployment administration and cross-cloud latency from Railway           | Use Vertex EU/Azure/Bedrock when requirements justify it            |
| Self-hosted open-weight                     | Maximum processing control                 | GPU platform, scaling, security, rollouts, observability, failover, uncertain quality | Post-MVP/enterprise-only                                            |

The port should return provider-neutral domain results plus usage metadata. A task policy should pin, per operation:

- provider/deployment and model ID;
- privacy class (`eu_zdr`, `eu_standard`, `global_standard`, etc.);
- prompt/schema version;
- input/output limits and timeout;
- effective-dated prices;
- synchronous/flex/batch permission;
- optional fallback satisfying the **same** privacy class and schema.

Do not silently fall back from EU/ZDR to global/default-retention. Provider failover must also preserve the quota reservation's idempotency key.

## 14. Batch and interactive paths

- Do not use vendor batch APIs for Phase 17's 60-second analysis target or interactive reply generation.
- OpenAI, Google, Azure, Anthropic, Mistral, and Bedrock batch paths are asynchronous and target completion over hours/within a day, not interactive latency.
- Batch fits approved historical backfill or scheduled trends, but ZDR/residency differs from synchronous calls. Anthropic and Mistral batches are not ZDR; Azure Global Batch can process globally; Bedrock/Vertex availability is model/region-specific.
- A normal BullMQ chunking strategy over synchronous ZDR calls is less discounted but has simpler per-review idempotency, quota settlement, and deletion behavior.

# Part III — Cost and packaging without product tiers

## 15. Unit-cost shape

These are **illustrative calculations**, not quotes. Assumptions:

- sentiment/category: 500 input + 100 output tokens;
- reply with instructions/examples: 2,000 input + 300 output;
- per-property trend: 20,000 input + 800 output;
- no cache discount, batch discount, tax, or reasoning-token uplift.

| Call               | OpenAI nano/mini | Gemini Flash-Lite/Flash | Anthropic Haiku/Sonnet | Mistral Small 4 |
| ------------------ | ---------------: | ----------------------: | ---------------------: | --------------: |
| Sentiment/category |        $0.000225 |               $0.000275 |              $0.001000 |       $0.000135 |
| Reply draft        |        $0.002850 |               $0.005700 |              $0.010500 |       $0.000480 |
| Property trend     |        $0.018600 |               $0.037200 |              $0.072000 |       $0.003480 |

Illustrative monthly workload, excluding separate guest-feedback categorization:

| Property profile              | Calls/month                               | OpenAI | Gemini | Anthropic |
| ----------------------------- | ----------------------------------------- | -----: | -----: | --------: |
| Typical                       | 100 review analyses, 30 drafts, 30 trends |  $0.67 |  $1.31 |     $2.58 |
| Busy                          | 500 analyses, 150 drafts, 30 trends       |  $1.10 |  $2.11 |     $4.24 |
| Busy + 25% retry/price buffer | Same logical work                         |  $1.37 |  $2.64 |     $5.29 |

These calculations are inferences from current list prices. Real costs depend on prompt length, multilingual tokenization, reasoning tokens, retries, schema compilation, few-shot examples, and how often a daily scheduler actually generates a new report. Trend calls dominate because the same review window is repeatedly submitted.

Product implication: the proposed `$10/$50/$500` quotas are technically safe but do not map to property count or user value and are likely generous for early traffic. They also expose vendor economics to users. Use dollars internally, not as the primary UX.

## 16. Packaging options

| Option                          | Predictability for customer |       Cost control | Product/engineering trade-off                                                                               |
| ------------------------------- | --------------------------: | -----------------: | ----------------------------------------------------------------------------------------------------------- |
| Hard monthly dollar cap         |                         Low |          Excellent | Provider prices are opaque to managers; changing models changes perceived entitlement                       |
| Fixed feature credits           |                      Medium |               Good | Portable across operations but requires explaining weights and handling model price drift                   |
| Per-property included allowance |                        High |               Good | Aligns with Phase 18's property scope and customer value; easiest future packaging                          |
| Metered AI add-on/overage       |                      Medium |          Excellent | Needs billing, notices, invoices, tax/accounting, and spend controls not present today                      |
| Bring your own key              |                  Low-medium | Shifts token spend | Does not solve GBP policy; adds secret management, support variance, and provider-specific behavior         |
| Fair use plus hidden safety cap |            High during beta |        Medium-good | Easiest launch, but enforcement can feel arbitrary unless limits become visible before general availability |

## 17. Recommended packaging sequence

### Stage 1 — Arc 7 beta

Do not introduce SaaS plan names. Add a generic per-organization AI entitlement with:

- status/mode (`disabled`, `beta`, `included`, `metered`, `byok` reserved for later);
- per-property logical allowances for analyses, drafts, and generated trend reports;
- an internal organization USD safety cap;
- optional organization override and effective dates;
- privacy/deployment class;
- graceful `quota_deferred`/`quota_exhausted` behavior.

Show managers meaningful counters only where action is manual—primarily reply drafts. Automatic analysis should degrade gracefully and never break the review inbox.

### Stage 2 — Observe real use

Measure for at least one representative billing cycle:

- reviews/feedback per property and language;
- drafts requested and published;
- trend reports generated versus skipped for insufficient change;
- p50/p95 tokens, cost, latency, retries, and failure rate per feature/provider/model;
- quality and support incidents.

### Stage 3 — Commercialize per property

Recommended eventual shape:

- a base product can include a modest per-property AI allowance;
- an **AI per-property add-on** increases analyses/drafts and enables daily per-property trends;
- high-volume/enterprise customers receive negotiated entitlements, regional/ZDR deployment, and possibly BYOK/dedicated hosting;
- optional prepaid credit top-ups or metered overage can come later.

Avoid a permanent unlimited/free promise until usage and support costs are known. If a free product tier is later created, define its AI allowance then; do not let Arc 7 create the commercial tier model accidentally.

## 18. Quota mechanics

Quota enforcement inside the adapter boundary should be **reservation → provider call → settlement**, not `SUM(month_cost)` followed by a remote call:

1. Atomically acquire a unique reservation for organization + operation + resource + prompt/model version.
2. Reserve a conservative amount based on bounded input and maximum output.
3. Reject gracefully if settled month-to-date + open reservations + requested reservation exceeds the safety cap/entitlement.
4. Call the provider.
5. Settle exact token categories and effective-dated estimated cost, including billable refusals.
6. Release only calls that provably never reached the provider; make settlement idempotent.

Store resource IDs, hashes, prompt/model/schema versions, provider request IDs, latency, stop/error class, raw token categories, price-table version, reserved and settled cost, and quota period. Avoid storing review prompt/response bodies in `ai_usage`.

# Part IV — Repository delivery consequences retained from the first investigation

## 19. Reusable baseline and mismatches

- BullMQ is already installed and the worker separates latency-sensitive/default work from background work. ([package](../../package.json), [worker](../../src/worker/index.ts))
- `reviews` already has sentiment fields and `replies` has `ai_generated`; new priority/version/category/trend/usage/entitlement state is still needed. ([review schema](../../src/shared/db/schema/review.schema.ts))
- The actual events are `review.created` and `guest.feedback.submitted`, not the names in the plan. ([review events](../../src/contexts/review/domain/events.ts), [guest events](../../src/contexts/guest/domain/events.ts))
- Initial GBP sync emits `review.created` for historical imports too. Add live/import provenance or suppress Phase 17 handlers and route imports through an explicitly approved backfill path.
- The in-process event bus logs handler errors and resolves. Persistence can therefore succeed while AI enqueueing is lost. A reconciliation scan or durable outbox is needed for a real 60-second target. ([event bus](../../src/shared/events/event-bus.ts))
- Inbox and feedback schemas lack the required AI projections/category fields. Existing review queries also lack cursor/range APIs suitable for bounded trends/backfills.
- There is no current plan/subscription source, confirming that generic AI entitlements should precede commercial tier mapping.

## 20. BullMQ reliability requirements

BullMQ can deliver work more than once in failure/stall scenarios. `jobId` and queue deduplication suppress some duplicates only while Redis/job state remains; neither replaces durable database uniqueness. Use idempotent analysis rows, trend keys, and usage settlement. ([BullMQ overview](https://docs.bullmq.io/), [idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs), [job IDs](https://docs.bullmq.io/guide/jobs/job-ids))

Use deterministic business keys such as:

```text
review analysis: (review_id, analysis_version)
feedback category: (feedback_id, category_version)
trend report: (property_id, period_start, period_end, report_version)
usage settlement: (provider, provider_response_id)
urgent event: (review_id, priority_version, threshold_version)
```

Phase 18 should use `upsertJobScheduler`; Job Schedulers replaced legacy repeatable jobs in BullMQ 5.16. A daily scheduler should fan out bounded per-property work, record the report period, and tolerate delayed execution. ([Job Schedulers](https://docs.bullmq.io/guide/job-schedulers))

The scheduler may run daily for every eligible property while generating a new AI report only when minimum evidence/change criteria are met. That preserves operational coverage without manufacturing meaningless daily themes for quiet properties.

## 21. Phase implications after this research

### Phase 17

- Treat the written response as satisfying the external policy gate for the submitted flow; preserve and encode it in ADR 0031/source policy.
- Implement the raw-content refresh/removal lifecycle and separate retained derived metadata.
- Remove structured reviewer identity and redact PII found inside review text before provider transfer.
- Require property-level merchant opt-in and an approved no-training/minimum-retention regional provider deployment.
- Define provider-neutral schemas, prompt/model versions, source lineage, and privacy class.
- Implement atomic entitlements/usage reservations before adapter calls.
- Persist reply drafts server-side with AI provenance and require separate manual publication.
- Version priority inputs/weights and fire an idempotent urgent event only on threshold crossing.
- Add durable handoff/reconciliation and idempotent jobs.
- Benchmark models against the phase's latency and quality gates; mocked adapter tests are not quality validation.

### Phase 18 — per property only

- No organization summary.
- Google's response permits per-property themes, trends, and summaries. Keep each prompt, batch partition, report, cache key, and query independently property-scoped.
- Retain only derived themes/trajectories/summary insights beyond the raw cache window; no excerpts, exact ratings, replies, reviewer identities, or reversible content fingerprints.
- Historical backfill may be planned conservatively, but its release criteria must enforce valid cached inputs and derivative-only persistence because Google did not answer it separately.
- Supported GBP Performance metrics and the live official Places review summary are adjacent capabilities, not replacements for custom review trends.
- Add paginated, time-bounded source queries, minimum sample/change rules, and per-property scheduling timezone.
- Keep generation off the dashboard request path; read precomputed reports/aggregates and use cache only as a performance layer.
- If an approved source has insufficient change, carry forward the latest report with a visible “no meaningful new evidence” state rather than spending tokens on a new summary.

## 22. Resolved and remaining decisions

| Decision                                                  | Status / evidence needed                                                                                                            |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| OAuth Web Server flow and merchant opt-in                 | Resolved conditionally by Google's written response; implement consent evidence and scope tests.                                    |
| Per-review AI transformation and per-property aggregation | Resolved conditionally by Google's written response.                                                                                |
| Derived values/reports outliving raw content              | Resolved: allowed, provided the retained data is derivative metadata and follows product/privacy retention.                         |
| External LLM transfer                                     | Resolved conditionally: PII removal, no training, minimum retention, and applicable regional privacy controls.                      |
| Automated reply publication                               | Resolved: unsupported; manual manager publication is mandatory.                                                                     |
| Exact raw-cache refresh semantics                         | Use refresh-before-30-days/purge-on-failure baseline; seek follow-up only if broader behavior is needed.                            |
| Durable previous-reply few-shot corpus                    | Not explicitly confirmed; use current same-property cached replies only by default.                                                 |
| Historical GBP backfill                                   | General per-property processing is permitted, but the named backfill question was not separately answered; retain derivatives only. |
| Production provider/deployment                            | Provider bake-off plus DPA, no-training/retention, regional, security, and procurement review.                                      |
| Model per operation                                       | Quality/latency/cost evaluation, not list-price intuition.                                                                          |
| Initial internal caps                                     | Beta workload assumptions, then measured usage.                                                                                     |
| Minimum evidence/change for a daily property report       | Product/quality decision validated in a controlled Google-review pilot.                                                             |

# Part V — Azure OpenAI and AWS Bedrock for a US-first product

This extension was checked on 2026-07-14. Prices are public USD list prices, not a quote or a negotiated enterprise rate. Azure meters were read through Microsoft's [Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices); AWS meters were read through the official [AWS Price List Bulk API](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/using-the-aws-price-list-bulk-api.html) and checked against the [Bedrock pricing page](https://aws.amazon.com/bedrock/pricing/). Both vendors can change prices and model availability, so the implementation must keep an effective-dated price table rather than hard-code these numbers into quota logic.

## 23. Recommended geography

Do not run one global endpoint for every customer. Use a `processing_region`/`privacy_class` routing decision on the organization or property and create two provider resources from the beginning:

| Market                       | Azure                                                                                                                          | Bedrock                                                                                         | Why                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| United States/default launch | Foundry/Azure OpenAI resource in East US 2; `DataZoneStandard` and `DataZoneBatch` deployments                                 | Bedrock client in `us-east-1`; US geographic inference profiles (`us.*`)                        | Processing remains within the United States while retaining multi-region capacity                                    |
| EU/EEA customers             | Separate resource in Sweden Central; EU `DataZoneStandard` and `DataZoneBatch` deployments                                     | Separate client in `eu-west-1`; EU geographic inference profiles (`eu.*`)                       | Processing remains within the EU data zone/geography and credentials, quotas, logs, and batch objects stay separated |
| Rest of world                | Route to US only when contract/privacy disclosures permit; add APAC or a required regional deployment when demand justifies it | Use an appropriate geographic profile where one exists; do not silently fall back to `global.*` | A global fallback changes the data-processing boundary                                                               |

Azure Data Zone routes within the selected US or EU zone; Global deployments may process anywhere. `DataZoneBatch` has the same zone boundary, a 50% discount, and a 24-hour target. ([Azure deployment types](https://learn.microsoft.com/en-us/azure/ai-foundry/foundry-models/concepts/deployment-types?view=foundry-classic), [model/region availability](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure-region-availability)) Bedrock geographic cross-region inference likewise stays within US/EU boundaries, has no routing surcharge, and keeps inter-region traffic on the AWS network; global profiles can route worldwide. ([Bedrock cross-region inference](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html), [geographic profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/geographic-cross-region-inference.html))

For the recommended Bedrock baseline, Nova 2 Lite publishes both `us.amazon.nova-2-lite-v1:0` and `eu.amazon.nova-2-lite-v1:0` geographic IDs. ([Nova 2 Lite model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html))

## 24. Azure OpenAI setup

1. Create an Azure tenant/subscription, one resource group per geography, cost budgets/alerts, and one Foundry/Azure OpenAI resource in East US 2 and Sweden Central.
2. Deploy `gpt-5-nano` for sentiment/category and `gpt-5-mini` for drafts and property trends using `DataZoneStandard`. Add a `DataZoneBatch` deployment of the trend model. Both models support strict structured outputs and are available in US and EU Data Zone deployments. ([structured outputs](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/structured-outputs), [availability](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure-region-availability))
3. Allocate TPM to each deployment, test 429 handling, and request quota increases before bulk onboarding. Azure quota is per subscription, region, model, and deployment type. At Tier 1, the documented Data Zone ceilings include 2M TPM/2,000 RPM for GPT-5 nano and 300k TPM/300 RPM for GPT-5 mini; higher subscription tiers increase these values. ([quota tiers](https://learn.microsoft.com/en-us/azure/foundry/openai/quotas-limits), [quota management](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/quota))
4. Use Microsoft Entra ID and assign only `Cognitive Services OpenAI User` to the production principal. Railway cannot use an Azure managed identity directly, so the practical launch choices are an Entra service principal credential or an Azure API key stored in Railway; Entra gives better RBAC/auditability. Azure supports both authentication methods. ([authentication reference](https://learn.microsoft.com/en-us/azure/foundry/openai/reference), [RBAC](https://learn.microsoft.com/en-us/azure/foundry-classic/openai/how-to/role-based-access-control))
5. Store separate US/EU endpoint, deployment, and credential settings. Call the stateless v1/chat interface and disable stateful Responses storage, Files, Threads, and stored completions for review content.
6. Apply for modified abuse monitoring if contractual zero-retention is required. Base inference models are stateless and Microsoft does not give prompts to OpenAI or use them to train models, but default abuse monitoring can select flagged prompts/completions for storage and human review. Approval removes that storage/human-review path; real-time automated review can remain. ([Azure data/privacy](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy))

No application, Neon, Redis, or Railway migration is required. This is an outbound HTTPS adapter plus geographic routing. A future move of only the worker to Azure could replace the service-principal secret with managed identity, but it is not required for Arc 7.

## 25. Bedrock setup

1. Create an AWS account/organization, budgets, and production access in `us-east-1` and `eu-west-1`.
2. Create a least-privilege IAM principal that can invoke only the approved model and inference-profile ARNs. Geographic cross-region IAM/SCP policy must allow every destination Region in the profile or calls fail. Add `CreateModelInvocationJob` and tightly scoped S3 access only for the batch worker. ([geographic IAM requirements](https://docs.aws.amazon.com/bedrock/latest/userguide/geographic-cross-region-inference.html))
3. Use Nova Micro for sentiment/category and benchmark Nova 2 Lite for drafting/trends. The current Nova documentation describes Micro as the fast classification model and Nova 2 Lite as the cost-efficient customer-support/automation model. ([Amazon model catalog](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-amazon.html)) Keep Claude Haiku 4.5/Sonnet 4.6 as the quality benchmark. Bedrock strict structured outputs are available on `bedrock-runtime` for the selected Claude models but not Nova 2 Lite, so Nova requires JSON/tool validation plus bounded repair/retry. ([structured outputs](https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html))
4. Bedrock model access is enabled by default when Marketplace prerequisites are present. Anthropic additionally requires a once-per-account/organization first-time-use form and acceptance of the third-party EULA. ([model access](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html))
5. From Railway, use the AWS SDK v3 Converse API. AWS recommends temporary credentials/IAM roles for production and long-term Bedrock API keys only for exploration. Because Railway is outside AWS, launch either with a narrowly scoped, rotated IAM credential or with an external-workload federation design; moving the worker to ECS/Lambda later would allow an attached IAM role. ([Bedrock API credentials](https://docs.aws.amazon.com/bedrock/latest/userguide/getting-started-api.html), [API-key warning](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys-generate.html))
6. Set/enforce zero data retention where supported. Bedrock documents zero operator access and zero data retention by default for the proposed Nova and existing Claude models; model providers do not have access to customer prompts/completions. The specific 30-day abuse-retention exceptions currently listed are newer GPT-5.4/5.5 and Claude Fable 5, not Nova Micro/2 Lite or Claude Haiku 4.5/Sonnet 4.6. ([abuse detection](https://docs.aws.amazon.com/bedrock/latest/userguide/abuse-detection.html), [data protection](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html), [retention modes](https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html))
7. Leave Bedrock model-invocation body logging disabled. It is disabled by default; enabling it can write full inputs/outputs to CloudWatch Logs/S3. Keep metadata, tokens, cost, latency, and provider request IDs in RepKey instead. ([invocation logging](https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html))
8. For trend batch jobs, use an encrypted S3 bucket in the same source geography with a short lifecycle (preferably one day after successful settlement; never over the approved GBP retention). Batch inference is 50% below on-demand for supported models. ([Bedrock pricing](https://aws.amazon.com/bedrock/pricing/))

This also requires no migration of Railway, Neon, or Redis. Bedrock has somewhat more setup surface than Azure: two regional clients, SigV4/IAM, inference-profile destination permissions, S3 batch jobs, and a separate EULA/FTU path for Claude.

## 26. Model price inputs

The price rows used below are the residency-preserving Data Zone/geographic rates, per one million text tokens:

| Provider/model/use                                 |           Input |          Output |      Batch input |     Batch output |
| -------------------------------------------------- | --------------: | --------------: | ---------------: | ---------------: |
| Azure GPT-5 nano, Data Zone, analysis              |          $0.055 |           $0.44 |          $0.0275 |            $0.22 |
| Azure GPT-5 mini, Data Zone, draft/trend           |          $0.275 |           $2.20 |          $0.1375 |            $1.10 |
| Bedrock Nova Micro, US / EU, analysis              | $0.035 / $0.040 |   $0.14 / $0.16 | $0.0175 / $0.020 |  $0.070 / $0.080 |
| Bedrock Nova 2 Lite, US / EU, draft/trend          | $0.330 / $0.374 | $2.750 / $3.157 |  $0.165 / $0.187 | $1.375 / $1.5785 |
| Bedrock Claude Haiku 4.5, geographic, analysis     |           $1.10 |           $5.50 |            $0.55 |            $2.75 |
| Bedrock Claude Sonnet 4.6, geographic, draft/trend |           $3.30 |          $16.50 |            $1.65 |            $8.25 |

Azure Data Zone prices are 10% above the corresponding Global meters. Bedrock's Claude geographic meters are also 10% above its Global profile meters. Nova pricing varies by source region. The exact AWS sources are the current [`AmazonBedrock` price file](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/index.json) for Nova and [`AmazonBedrockFoundationModels` price file](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels/current/index.json) for Claude. Global profiles can be cheaper, but that discount is not a reason to weaken a declared US/EU boundary.

## 27. Cost scenarios

Assumptions are deliberately identical to section 15:

- 100 review analyses/property/month at 500 input + 100 output tokens;
- 30 reply drafts at 2,000 input + 300 output tokens;
- 30 property trend generations at 20,000 input + 800 output tokens;
- analysis and drafts use online standard inference; trends use 50%-discounted batch;
- no cache discount, retries, taxes, negotiated discount, or optional guardrail charge;
- billed output is assumed to fit the stated token allowance; Azure GPT reasoning tokens or retries can make actual usage higher.

| Deployment/model mix                             | Per property | 100 properties | 1,000 properties | 10,000 properties |
| ------------------------------------------------ | -----------: | -------------: | ---------------: | ----------------: |
| Azure Data Zone: GPT-5 nano + mini               |      $0.1524 |         $15.24 |          $152.35 |         $1,523.50 |
| Bedrock US Geo: Nova Micro + Nova 2 Lite         |      $0.1797 |         $17.97 |          $179.70 |         $1,797.00 |
| Bedrock EU Geo: Nova Micro + Nova 2 Lite         |      $0.2045 |         $20.45 |          $204.54 |         $2,045.37 |
| Bedrock US/EU Geo: Claude Haiku 4.5 + Sonnet 4.6 |      $1.6445 |        $164.45 |        $1,644.50 |        $16,445.00 |

Without batch, the same per-property totals are approximately $0.2613 for Azure, $0.3117 for US Nova, $0.3546 for EU Nova, and $2.8325 for Claude. Add at least a 25% operating buffer for retries, multilingual tokenization, schema repair, model-price changes, and unusual review length. With that buffer, the 10,000-property batch estimates become roughly $1,904 Azure, $2,246 US Nova, $2,557 EU Nova, or $20,556 Claude per month.

The table batches only daily trends; analysis retains its 60-second path and drafts remain interactive. Bedrock batch jobs require at least 100 records, so aggregate trends across properties within the same residency cell. A small launch below roughly 100 eligible daily property reports must use on-demand trends, generate less frequently, or wait until a batch reaches the minimum; never mix US and EU records merely to fill a batch. ([Bedrock batch limitations](https://docs.aws.amazon.com/bedrock/latest/userguide/batch-inference.html))

These numbers expose the most important cost fact: model quality and prompt size matter much more than account count. Daily 20k-token trend windows dominate cost. Skipping trend generation when evidence has not changed is more valuable than minor per-token optimization.

## 28. Non-model costs and operational choice

- Neither Azure pay-as-you-go deployments nor Bedrock on-demand serverless models require a dedicated endpoint/hourly hosting fee.
- Railway can hold the small number of launch credentials, so Azure Key Vault/AWS Secrets Manager are optional rather than mandatory. If AWS Secrets Manager is adopted, public list price is $0.40/secret/month plus $0.05/10,000 API calls. ([Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/)) Azure Key Vault Standard secret operations were $0.03/10,000 operations in the checked Retail Prices API.
- Batch S3 object storage and requests, token/cost metadata logs, and ordinary HTTPS data transfer should be small beside model spend when bodies are deleted promptly. Do not add NAT Gateway, PrivateLink, Azure VNet, or cross-cloud private networking for the beta: public TLS endpoints avoid their fixed networking costs. Re-evaluate private connectivity only for an enterprise contractual requirement.
- For scale context, an AWS NAT Gateway pricing example is $0.045/hour (about $32.85/month) plus $0.045/GB before other transfer/AZ charges. A Bedrock PrivateLink runtime interface endpoint across two Availability Zones is roughly $14.60/month at the US example's $0.01/endpoint-hour, plus $0.01/GB at the first data tier; batch/control-plane access can require another endpoint. These are avoidable while Railway calls the public TLS service. ([VPC pricing](https://aws.amazon.com/vpc/pricing/), [Bedrock PrivateLink](https://docs.aws.amazon.com/bedrock/latest/userguide/vpc-interface-endpoints.html), [PrivateLink pricing](https://aws.amazon.com/privatelink/pricing/))
- Full invocation logging is also optional. AWS CloudWatch standard log ingestion is approximately $0.50/GB in its public examples, while the checked Azure East US Retail Prices meter for Analytics Logs was $2.30/GB. Exact region/contract prices vary, and prompt bodies should not be logged at all. ([CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/), [Azure Monitor pricing](https://azure.microsoft.com/en-us/pricing/details/monitor/))
- Do not export prompt/response bodies to Azure Monitor, CloudWatch, S3, or a third-party observability vendor. Metadata-only logs should remain small; verbose body logging creates both cost and GBP-retention risk.
- At 10,000 properties, Azure Tier 1's 300k GPT-5-mini Data Zone TPM is enough for average monthly throughput but not an unshaped midnight trend burst. Use the separate batch quota, stagger work per property timezone, and request increases before onboarding that scale. Current Bedrock geographic defaults include 2,000 RPM/8M combined TPM for Nova 2 Lite, 10,000 RPM/5M TPM for Claude Haiku 4.5, and 10,000 RPM/6M TPM for Claude Sonnet 4.6, but quotas are account/Region/profile-specific and AWS can change allocations based on account factors. Inspect Service Quotas and request increases rather than treating public defaults as a capacity guarantee. ([Bedrock endpoint quotas](https://docs.aws.amazon.com/general/latest/gr/bedrock.html), [quota behavior](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html))

Recommendation: **benchmark Azure GPT-5 nano/mini against Bedrock Nova Micro/Nova 2 Lite and Claude, but provision Azure Data Zone first if quality is comparable.** Azure is the cleanest fit for this codebase: strict structured outputs, one OpenAI-compatible client, straightforward US/EU zoning, and the lowest modeled cost among the current-generation quality candidates. Bedrock is preferable if its default ZDR posture or AWS enterprise procurement is decisive; Nova is cost-competitive but needs stronger schema validation/retry code, while Claude is the quality benchmark and is about an order of magnitude more expensive for the trend-heavy workload.

## Revised bottom line

Arc 7 is a viable **actual-Google-review AI** direction under Google's written per-property disposition. The external permission question is no longer the blocker; the work is now to prove the conditions in code and operations: raw/derived separation, 30-day refresh/removal, PII redaction, merchant opt-in, no-training/minimum-retention regional providers, per-property isolation, and manual publication. Provider portability, quotas, durable jobs, reply UX, and property reports remain the correct design. For a US-first product with EU expansion, the practical managed-cloud bake-off should include Azure US/EU Data Zone, Bedrock US/EU geographic Nova, and Bedrock Claude as a quality ceiling. Commercially, start with generic internal entitlements and per-property caps; use real data before inventing Free/Pro/Enterprise plans.
