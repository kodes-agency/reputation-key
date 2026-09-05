# AI Governance Primary-Source Research

**Status:** Research baseline for the pre-Phase-17 governance package  
**Researched:** 2026-07-14  
**Applies to:** Google Business Profile review analysis and AI-assisted reply drafting, scoped to one property  
**Not legal advice:** RepKey must obtain qualified privacy/legal review for its actual entities, contracts, markets, and processing activities.

## 1. Purpose and evidence labels

This note identifies the primary sources behind ADR 0031, the executable source-content policy, AI-provider approval, merchant consent, redaction, regional routing, retention, and release evidence. It deliberately separates four kinds of conclusion:

- **Public requirement** — stated in law, an official public policy, or a binding product term.
- **Case-specific evidence** — stated in the written Google Business Profile API Support response supplied by RepKey's product owner. It applies to the architecture Google was shown, not every future use.
- **Design inference** — RepKey's conservative engineering response to one or more requirements. It is not presented as the source's exact wording.
- **Open question** — not established by the reviewed sources and requiring a product decision, provider evidence, counsel, or further written clarification.

Provider documentation and service behavior change. The provider findings below were checked on 2026-07-14 and must be revalidated against the exact model, endpoint, deployment type, region, contract, and account configuration before release.

## 2. Executive conclusions

1. **The Google review cache needs a real lifecycle boundary.** Google's public Business Profile API policy permits only limited temporary content storage to improve project performance and requires stored content to be secure, unmanipulated/unaggregated, and retained for no more than 30 calendar days. The policy is mutable and explicitly places update-monitoring responsibility on the developer. [Google Business Profile API policies](https://developers.google.com/my-business/content/policies)

2. **Google's written response supplies the case-specific interpretation needed for the proposed AI design.** It permits independently generated per-property sentiment, themes, trends, and summaries; treats non-reproducing derived metadata as outside the raw-content 30-day limit; permits external AI after PII removal, no-training assurance, minimal retention, and regional privacy compliance; and requires merchant opt-in plus manager-reviewed manual reply publication. [RepKey's preserved Google response](google-business-profile-ai-policy-response-2026-07-14.md)

3. **The public policy and support response must be implemented together.** Raw review text, ratings, reviewer data, replies, and reproducing prompt bodies stay in the expiring source-content boundary. Approved derived records remain property-scoped and must not reproduce raw content or PII. Materially broader behavior requires renewed review.

4. **Regional processing is not proved by a resource label.** GDPR does not impose a general rule that EEA personal data must stay in the EEA; it requires a lawful processing basis and Chapter V safeguards when personal data is transferred to a third country. Provider products separately distinguish storage, inference, abuse-monitoring, system metadata, support access, and failover locations. [GDPR Articles 5, 6, 28, 32 and 44–46](https://eur-lex.europa.eu/eli/reg/2016/679/oj), [European Commission transfer guidance](https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/obligations/what-rules-apply-if-my-organisation-transfers-data-outside-eu_en)

5. **“No training” does not mean “no retention” or “no human access.”** Each provider has separate rules for model training, abuse monitoring, application state, files/batches, regional processing, and exceptional safety retention. Approval therefore needs an endpoint-and-model retention matrix plus executable configuration evidence, not a provider-wide marketing statement.

6. **Release evidence is a control, not paperwork after the fact.** GDPR accountability and privacy-by-design require RepKey to implement and demonstrate appropriate measures; NIST's voluntary AI RMF recommends documented governance, pre-deployment measurement, third-party risk management, ongoing monitoring, incident response, and decommissioning. [GDPR Articles 5(2), 24 and 25](https://eur-lex.europa.eu/eli/reg/2016/679/oj), [NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/), [NIST AI 600-1 Generative AI Profile](https://doi.org/10.6028/NIST.AI.600-1)

## 3. Google Business Profile content and authorization

### 3.1 Public policy requirements

The [Business Profile API policies](https://developers.google.com/my-business/content/policies) establish the following public baseline:

- API use is limited to listings the developer owns, is authorized to manage, or enables an end client to manage.
- An end client must have a quick and easy way to stop using the service. After notice, the developer has seven business days to enable disassociation and must relinquish/remove management permissions.
- Actions such as review replies must not be automatically triggered without the user's prior specific and express consent.
- Content obtained through the API may be stored only in limited amounts to improve project performance, securely, for no more than 30 calendar days, and may not be manipulated or aggregated.
- Google may review API use, strictly enforce the policy, and change it; the developer is responsible for staying current.

Google's [third-party Business Profile policy](https://support.google.com/business/answer/7353941) separately requires express business-owner consent to claim/manage a profile and explicit approval to reply to reviews on the customer's behalf. It requires written or digital proof of consent when challenged.

Google's general [API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy) requires accurate identity and purpose disclosures, a public privacy policy describing access/use/storage/sharing, renewed notice and consent for a newly introduced use, minimum relevant permissions, and reasonable protection of user data and derived data in transit and at rest. Where its additional sensitive/restricted-scope requirements apply, they also constrain raw and derived data use and transfers; the applicable Google Cloud Console scope classification and verification path must be captured rather than assumed.

### 3.2 Case-specific Google Support evidence

The written response preserved in [Google Business Profile AI Policy Response and Disposition](google-business-profile-ai-policy-response-2026-07-14.md) was supplied by RepKey's product owner. The repository does not independently authenticate the email headers, sender, or support case.

For the architecture submitted to Google, the response says:

- per-property sentiment, themes, and trend summaries are permitted when generated independently for each Business Profile and not used to create misleading or combined ratings across unrelated properties;
- raw review text, star ratings, reviewer information, and replies are subject to the applicable 30-day refresh/removal policy;
- sentiment labels, scores, categories, themes, and summary insights are derivative metadata not subject to that same 30-day limit;
- external AI processing is permitted after PII removal, no-training assurance, minimal retention, and compliance with regional privacy rules;
- OAuth 2.0 Web Server flow with the appropriate Business Profile scope, merchant opt-in, and a separate manager-reviewed manual publish action are aligned with the recommended approach; and
- automatic publication of AI-generated replies without human review is not supported.

This is strong first-party case evidence, but it is not a public policy amendment or unrestricted approval. Preserve the original email, headers, support case number, submitted request, and attachment in the controlled compliance-evidence store.

### 3.3 Required operating interpretation

The following are **design inferences** for ADR 0031 and `SourceContentPolicy`:

- Put review text, rating, reviewer identity, Google review identifiers, reply text, and reproducing prompt/few-shot bodies in one auditable raw-content class.
- Calculate `refresh_due_at` before the public-policy maximum and enforce a hard expiry. A local timestamp update must never count as a source refresh.
- Put sentiment, priority, category, theme, trajectory, and non-reproducing property summary facts in a separate derived class with its own product/privacy retention schedule.
- Never use review data from unrelated Business Profiles in the same prompt, report, rating, or durable summary.
- Keep raw bodies out of queues, ordinary logs, traces, analytics, notifications, audit descriptions, and provider diagnostics.
- Fail closed for new AI work when policy, consent, property region, provider deployment, model, or retention configuration is unknown. Non-AI review management should remain available.
- Re-submit for policy review before cross-property analysis, automated publication, provider training, materially longer provider retention, or a new data use.

**Open questions:** The sources reviewed do not conclusively define the exact event that restarts a refreshed item's 30-day clock, durable use of old replies as style examples, or treatment of expired content in backups. The conservative design should use successful source re-fetch evidence, avoid a durable raw-reply corpus, and make restore-time purge enforcement part of backup design.

## 4. OAuth web-server and token-security baseline

The [Business Profile OAuth guide](https://developers.google.com/my-business/content/implement-oauth) requires OAuth 2.0 for API requests and lists `https://www.googleapis.com/auth/business.manage` as the current scope; `plus.business.manage` is deprecated and retained only for backward compatibility. It describes owner consent and later revocation.

The [Google web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server) supports the authorization-code web-server flow and documents the following security-relevant behavior:

- production redirect URIs use HTTPS and must exactly match an authorized URI;
- a cryptographically random `state` value is used and verified to reduce CSRF risk;
- client secrets are stored where only the application can access them;
- scopes should be requested in context, using incremental authorization where appropriate;
- offline access returns a refresh token for background API access; and
- applications can programmatically revoke grants, including during unsubscribe/removal.

Google's [OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices) require secure handling of client credentials and user tokens, encryption at rest for server-side applications holding many tokens, no plaintext token transmission, and revocation/deletion when tokens are no longer needed. [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html) is the current IETF OAuth 2.0 Security Best Current Practice and should be used for the broader threat model.

**Design inference:** RepKey should use a backend-for-frontend/confidential web-server implementation, server-side code exchange, exact redirect allowlisting, one-time state bound to the initiating user/session and intended property, encrypted refresh tokens with key rotation, least-privilege token access, no browser persistence, revocation on disconnect, and tests for callback substitution, replay, partial grants, expired/revoked tokens, and account confusion. Add PKCE S256 where supported by the chosen Google library/flow; record it as defense in depth rather than claiming the Business Profile web-server page mandates it.

The production app's actual OAuth scope classification and verification status must be recorded from Google Cloud Console. Google's [OAuth verification documentation](https://support.google.com/cloud/answer/13463073) says public apps using scopes categorized as sensitive or restricted require the applicable verification, while the Console identifies the classification.

## 5. Privacy and regional processing

### 5.1 GDPR-confirmed principles

The official [GDPR text](https://eur-lex.europa.eu/eli/reg/2016/679/oj) supplies the following requirements when GDPR applies:

- Article 5: lawfulness/fairness/transparency, purpose limitation, data minimization, accuracy, storage limitation, integrity/confidentiality, and demonstrable accountability.
- Article 6: every processing purpose needs an applicable lawful basis. Merchant opt-in to a product feature is not automatically the lawful basis for processing a reviewer's personal data.
- Articles 24–25: the controller implements, reviews, and demonstrates risk-appropriate measures and privacy by design/default, including limiting the amount, extent, storage period, and accessibility of personal data.
- Article 28: use only processors providing sufficient guarantees under a binding processing contract covering documented instructions, confidentiality, security, subprocessors, rights assistance, deletion/return, and audit evidence.
- Article 32: implement risk-appropriate technical and organizational security measures and regularly test their effectiveness.
- Article 35: perform a DPIA before processing likely to create high risk, especially certain new-technology, large-scale, sensitive-data, monitoring, or significantly affecting automated-evaluation uses.
- Articles 44–46: an EEA-to-third-country transfer must satisfy Chapter V, through an adequacy decision or appropriate safeguards such as approved standard contractual clauses, as applicable.

The European Commission explains that GDPR protection travels with personal data outside the EEA and lists adequacy decisions, standard contractual clauses, binding corporate rules, and other mechanisms as transfer tools. [European Commission international-transfer guidance](https://commission.europa.eu/law/law-topic/data-protection/rules-business-and-organisations/obligations/what-rules-apply-if-my-organisation-transfers-data-outside-eu_en)

Removing a structured reviewer name is not necessarily anonymization. The Commission notes that pseudonymized or de-identified data that can still be used to re-identify a person remains personal data. [European Commission: data protection explained](https://commission.europa.eu/law/law-topic/data-protection/data-protection-explained_en)

**Design inference:** Free-form reviews must be treated as potentially containing personal and sensitive information. RepKey should remove structured identity and run language-tested redaction before provider transmission, minimize property context, and prohibit raw prompt/response logging. Redaction reduces risk but does not by itself prove that the remaining data is anonymous.

### 5.2 What property-region routing should mean

GDPR does not establish blanket EEA data localization. **Property-region routing is a RepKey design control** that reduces transfer and operational risk and lets the product honor customer/provider commitments.

An approved regional route must separately state and prove:

- application storage region;
- queue/job and temporary-file region;
- inference-processing region or permitted geographic zone;
- provider application-state and abuse-monitoring locations;
- support and human-review access locations;
- system/usage metadata exclusions;
- backup and disaster-recovery locations;
- subprocessor and onward-transfer mechanism; and
- failover behavior.

A route must not silently fall back to a global deployment. If the required regional deployment is unavailable, the AI operation should fail closed and leave non-AI features working.

### 5.3 California

California's Attorney General describes CCPA rights to know, delete, opt out of sale/sharing, correct, limit certain sensitive-information uses, and receive notice at or before collection. The published applicability thresholds include certain for-profit businesses doing business in California based on revenue, buying/selling/sharing data of 100,000 or more California residents or households, or revenue share from selling personal information. [California Attorney General CCPA overview](https://oag.ca.gov/privacy/ccpa)

The California Privacy Protection Agency's enforcement advisory says data minimization applies to each purpose for which a covered business collects, uses, retains, and shares personal information, and frames the test as reasonable necessity and proportionality. [CPPA Enforcement Advisory 2024-01](https://cppa.ca.gov/pdf/enfadvisory202401.pdf)

**Open legal question:** This research does not establish that RepKey is a CCPA-covered business, that every public review field is CCPA personal information, or the controller/business/service-provider roles for every customer relationship. Assess applicability, contracts, notices, rights routing, and “sale/sharing” with qualified counsel before US beta expansion. The minimization, notice, deletion, and vendor-control practices are sensible product baselines even before statutory applicability is resolved.

## 6. AI risk and governance baseline

NIST's [AI Risk Management Framework 1.0](https://doi.org/10.6028/NIST.AI.100-1) is voluntary and use-case agnostic. It organizes lifecycle risk management into **Govern, Map, Measure, and Manage**. The [AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/) calls for documented legal/regulatory requirements, roles, AI inventory, risk tolerance, ongoing review, decommissioning, context mapping, pre-deployment and ongoing testing, prioritization, monitoring, and response.

NIST's [Generative AI Profile, NIST AI 600-1](https://doi.org/10.6028/NIST.AI.600-1) is also voluntary. It identifies data privacy, confabulation, harmful bias, human-AI configuration, information integrity/security, and third-party value-chain integration as relevant risks. Its suggested actions support:

- an inventory of approved AI systems, providers, data provenance, known issues, and human-oversight roles;
- contracts/SLA terms for ownership, usage rights, security, quality, provenance, incidents, and service changes;
- use-case-based supplier assessment, approved-provider lists, and ongoing third-party monitoring;
- documented fallbacks and rehearsed incident response, including manual processing;
- representative, context-specific pre-deployment testing and sharing results with release approvers;
- post-deployment monitoring, feedback, override, change management, deactivation, and decommissioning; and
- retention of sufficient TEVV and decision evidence without retaining prohibited source content.

**Design inference:** RepKey should adapt, not mechanically copy, the NIST framework. For this limited use case, the minimum evidence is an AI system card, data-flow/threat model, provider approval, property consent, source-policy configuration, PII-redaction evaluation, model/prompt/schema versions, representative US/EU and language tests, human-review usability test, failure/fallback drill, monitoring thresholds, incident owner, and signed release decision.

## 7. Provider-neutral due diligence

Before a provider/model/deployment is allowlisted, require all of the following:

| Decision area                | Approval evidence                                                                                                                                                                     | Source basis                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Processing role and contract | Applicable signed DPA; controller/processor roles; instructions; confidentiality; subprocessor list/change notice; rights assistance; breach terms; deletion/return; audit evidence   | GDPR Article 28; NIST AI 600-1 third-party governance                  |
| International transfer       | Processing and support-access countries; adequacy/SCC or other mechanism; onward-transfer terms; transfer assessment where required                                                   | GDPR Articles 44–46                                                    |
| No training/secondary use    | Contract and product docs stating API content is not used for model improvement unless explicitly enabled; all sharing/feedback opt-ins disabled and evidenced                        | Google case-specific condition; GDPR purpose limitation                |
| Retention                    | Matrix by exact model, endpoint, feature and request mode covering abuse logs, application state, files, batches, caching, safety exceptions, deletion timing, and backups            | Google case-specific condition; GDPR storage limitation; provider docs |
| Human/provider access        | What can trigger review, whether automated or human, reviewer/support location, access controls, and exceptional-retention powers                                                     | Google PII/minimum-retention condition; GDPR Articles 28 and 32        |
| Regional route               | Separate proof for storage, inference, monitoring, metadata, support, subprocessors, backup and failover; global routing technically denied where disallowed                          | GDPR Chapter V; provider deployment docs                               |
| Security                     | Encryption, least-privilege workload identity, key handling, private networking where justified, audit events, vulnerability/incident process, current independent assurance evidence | GDPR Article 32; NIST AI RMF                                           |
| Model/service lifecycle      | Exact model/version, endpoint, deployment SKU, deprecation/change notice, fallback, incident and exit plan                                                                            | NIST AI RMF Govern/Manage and AI 600-1                                 |
| Quality and safety           | Structured-output validation, review-task evaluation, multilingual/redaction testing, error taxonomy, human override, rate/cost limits, monitoring thresholds                         | NIST AI RMF Measure/Manage                                             |
| Executable proof             | Configuration export/API result showing provider, account/project, model, region/zone, retention mode, logging/monitoring state, and policy version                                   | GDPR accountability; NIST documented governance                        |

A compliance certification or a “no training” FAQ is supporting evidence, not the complete decision. Provider approval is specific to the allowlisted combination and must be revoked or reapproved when the model, endpoint, region, deployment type, retention mode, feature set, contract, or relevant provider policy changes.

## 8. Dated provider snapshot

This section is comparison evidence, not a provider recommendation.

### 8.1 OpenAI API

OpenAI's current [API data-controls documentation](https://developers.openai.com/api/docs/guides/your-data) says API data is not used to train/improve models unless the customer opts in. Default abuse-monitoring logs may contain prompts/responses and are retained up to 30 days, subject to stated legal/safety exceptions. Modified Abuse Monitoring and Zero Data Retention require approval and have endpoint/feature limitations; application-state retention is separate. Data residency is configured per project, does not cover system data, and regional storage does not always imply regional processing. Non-US regions have additional approval/contract requirements.

The [OpenAI DPA](https://openai.com/policies/data-processing-addendum/) and [subprocessor list](https://openai.com/policies/sub-processor-list/) must be reviewed for the contracting entity, instructions, transfers, deletion/return, security, and current subprocessors. Capture the exact project settings and endpoint/model retention row; do not infer ZDR from an organization-level approval alone.

### 8.2 Azure-hosted models / Azure OpenAI

Microsoft's [Foundry model data, privacy, and security documentation](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy) says prompts/completions are unavailable to model providers and are not used to improve Microsoft/provider products or train foundation models without customer permission. Base inference is stateless, but stored features, files, batches, fine-tuning, and similar capabilities create separate application state. Default abuse monitoring may select flagged prompts/completions for human review; modified abuse-monitoring approval removes the described storage/human-review process, while synchronous automated review can remain. Microsoft documents `ContentLogging=false` as configuration evidence that abuse-monitoring storage is off.

Microsoft's [deployment-type documentation](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types) says Global deployments may process in any Azure region, Data Zone deployments process within the selected US/EU/APAC zone, and Standard/Regional deployments process in the deployment region; stored data remains in the designated Azure geography. RepKey therefore must forbid Global deployments for properties whose route does not allow global processing and verify the exact deployment SKU.

The applicable [Microsoft Products and Services DPA](https://www.microsoft.com/licensing/docs/view/Microsoft-Products-and-Services-Data-Protection-Addendum-DPA?lang=1) and current product terms remain part of approval.

### 8.3 Amazon Bedrock

AWS's current [Bedrock data-retention documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html) exposes retention modes, model-specific allowed modes, account/project configuration, and a `none` mode that blocks models unable to honor zero durable retention. The documentation explicitly warns that `store=false` alone does not guarantee zero retention and that model policies vary. This should be enforced and evidenced per model, not inferred from Bedrock generally.

AWS says Bedrock content is not used to improve base models and is not shared with model providers under its general service posture, but the newer retention controls document explicit model/mode exceptions. [Amazon Bedrock FAQ](https://aws.amazon.com/bedrock/faqs/), [Bedrock retention](https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html)

AWS's [geographic cross-Region inference documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/geographic-cross-region-inference.html) keeps processing inside a named geography but may move prompts/results between its regions and may store abuse-detection data in the destination region. [Global cross-Region inference](https://docs.aws.amazon.com/bedrock/latest/userguide/global-cross-region-inference.html) can route worldwide and documents an SCP deny pattern. RepKey must use an allowlisted geographic/single-region route and explicitly deny global profiles where the property policy requires it.

The applicable [AWS DPA guidance](https://docs.aws.amazon.com/whitepapers/latest/navigating-gdpr-compliance/aws-data-processing-addendum-dpa.html), service terms, exact model terms, retention mode, inference profile, regions, and IAM/SCP evidence are all required.

## 9. Governance-gate mapping

| Gate                     | What should be documented now                                                                                                                | Evidence required before AI release                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| ADR 0031                 | Public-policy/case-evidence hierarchy; raw/derived definitions; per-property boundary; prohibited uses; fail-closed and change-control rules | Approved ADR version and policy-owner sign-off                                                              |
| Executable source policy | Typed capabilities, TTL/refresh rules, derivative rules, region, consent, redaction, provider and policy versions                            | Automated policy tests; expiry/purge drill; restore-time purge proof; production configuration export       |
| Provider review          | Provider-neutral checklist and approval/reapproval workflow                                                                                  | Signed/applicable contract/DPA; dated docs; exact endpoint/model/region/retention/configuration evidence    |
| Consent                  | Per-property opt-in, disclosure contents, authorized actor, consent epoch, revocation and disconnect semantics                               | Tested UI/API; immutable metadata evidence; revocation/pending-job race test                                |
| Redaction                | PII classes, languages, pipeline boundary, fail behavior, quality thresholds and escalation                                                  | Representative evaluation; leakage/false-positive results; prompt/log inspection; signed threshold decision |
| Regional routing         | Property region taxonomy; allowed deployment profiles; no-global-fallback rule                                                               | Route integration tests; cloud policy/config export; failure drill; transfer-mechanism evidence             |
| Retention                | Raw, derived, provider, queue/log/trace, backup and evidence schedules                                                                       | Automated deletion results; provider deletion/config proof; backup restore/purge drill                      |
| Release evidence         | Evidence index, owners, approvers, freshness and invalidation rules                                                                          | Complete dated pack, unresolved-risk acceptance, go/no-go record and rollback owner                         |

## 10. Open decisions and mandatory revalidation

Before Phase 17 implementation planning is declared ready, the governance package still needs decisions on:

1. RepKey's GDPR roles and lawful bases for review analysis and merchant-facing features.
2. Whether a DPIA is legally required; performing a proportionate privacy/AI impact assessment is recommended regardless.
3. CCPA applicability and US customer/data-subject rights routing.
4. The exact US, EEA, and rest-of-world property-region taxonomy and whether any customers can knowingly accept global processing.
5. Raw-cache refresh semantics and backup/restore deletion behavior.
6. Derived-metadata retention and treatment after property disconnect/deletion.
7. Redaction languages, test corpus, leakage threshold, and manual escalation.
8. Provider/model/deployment allowlists and acceptable abuse-monitoring retention.
9. Whether historical backfill and prior-reply style examples remain within the conservative Google interpretation.
10. Evidence owners, review frequency, incident escalation, and reapproval triggers.

Recheck the public Google policies, OAuth requirements, privacy law analysis, provider terms/docs, exact configuration, model behavior, and support evidence before every material AI release and at least quarterly while the feature is active.
