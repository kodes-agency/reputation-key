# AI Provider Assessment Template

**Status:** Ready template; no provider is approved by this document  
**Owners:** Privacy, security, engineering, operations, product  
**Use:** One completed assessment per exact provider/service/model/deployment type/region/retention configuration  
**Research baseline:** [AI governance primary sources](../ai-governance-primary-sources-2026-07-14.md)

## 1. Assessment identity

| Field                                 | Value                                                           |
| ------------------------------------- | --------------------------------------------------------------- |
| Assessment ID                         |                                                                 |
| Status                                | `draft / reviewing / approved / rejected / suspended / expired` |
| Provider and contracting entity       |                                                                 |
| Service/product                       |                                                                 |
| Model/family and version policy       |                                                                 |
| API endpoint/request mode             |                                                                 |
| Deployment type/SKU/inference profile |                                                                 |
| RepKey cloud account/project/resource |                                                                 |
| Processing cell                       | `us / europe / global`                                          |
| Configured cloud region/zone          |                                                                 |
| Intended capabilities                 |                                                                 |
| Intended input/output data classes    |                                                                 |
| Assessment owners/reviewers           |                                                                 |
| Assessed at                           |                                                                 |
| Approval expires at                   |                                                                 |
| Replaces assessment                   |                                                                 |

## 2. Decision rule

Provider selection has two stages:

1. **Hard eligibility gates.** Any failed or unproved hard gate rejects the deployment regardless of price, quality, or convenience.
2. **Comparative evaluation.** Eligible deployments are compared on task quality, redaction compatibility, latency, reliability, operations, portability, and cost using the same representative corpus and load profile.

A provider-wide FAQ, certification, cloud region name, or “no training” sentence cannot approve a deployment by itself.

## 3. Hard gates

Use `pass`, `fail`, or `not proved`. `Not proved` is a failure for release.

| Gate | Requirement                                                                                                                                                                      | Status | Evidence reference / finding |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------- |
| G1   | Signed/applicable contract and DPA identify the correct entities, roles, instructions, confidentiality, security, subprocessors, deletion/return, incident and audit terms       |        |                              |
| G2   | International processing/support locations and applicable adequacy/SCC/other transfer mechanism are documented and approved where required                                       |        |                              |
| G3   | Submitted API data is not used to train/improve models or for unrelated secondary purposes; every optional sharing/feedback/training setting is disabled                         |        |                              |
| G4   | Retention is documented for the exact endpoint/model/request mode, including abuse monitoring, application state, files, batches, caching, safety exceptions, errors and backups |        |                              |
| G5   | Provider retention is the minimum acceptable for the use case and is enforced through available account/project/deployment controls                                              |        |                              |
| G6   | Human/provider access triggers, reviewer/support locations, access controls and exceptional retention are known and accepted                                                     |        |                              |
| G7   | Inference, storage, abuse monitoring, metadata, support, subprocessor, backup and failover locations satisfy the target Property Processing Profile                              |        |                              |
| G8   | Global/cross-region fallback is technically denied unless that exact route is approved; same-cell failover is documented                                                         |        |                              |
| G9   | Encryption, workload identity/least privilege, credential rotation, tenant isolation, auditability, vulnerability handling and incident notification meet the security baseline  |        |                              |
| G10  | Prompt/response content logging is disabled or strictly bounded as approved; RepKey observability receives metadata only                                                         |        |                              |
| G11  | The exact model/endpoint supports the required structured output, content limits, languages, safety behavior and deletion/cancellation semantics                                 |        |                              |
| G12  | Provider files/batches/fine-tuning/vector stores or other stateful features are disabled unless separately assessed                                                              |        |                              |
| G13  | Service/model change and deprecation notice, availability, rate limits, quota escalation, incident status and exit/export behavior are acceptable                                |        |                              |
| G14  | RepKey can export configuration/API evidence proving the assessed deployment is the one actually invoked                                                                         |        |                              |
| G15  | No contractual or technical behavior conflicts with Google’s case-specific PII-removal, no-training, minimum-retention, regional, opt-in and manual-publication conditions       |        |                              |

### Hard decision

| Decision                                          | Value      |
| ------------------------------------------------- | ---------- |
| Eligible for comparative evaluation?              | `yes / no` |
| Rejected/conditional gates                        |            |
| Conditions that must be completed before approval |            |

## 4. Data-use and retention matrix

Complete one row per provider feature/request mode used. Do not write “same as provider policy” without a dated direct source and configuration proof.

| Feature/mode                      | Prompt/input retained? | Output retained? | Duration | Purpose | Human access? | Storage/processing location | Deletion mechanism | Evidence |
| --------------------------------- | ---------------------- | ---------------- | -------- | ------- | ------------- | --------------------------- | ------------------ | -------- |
| Synchronous inference             |                        |                  |          |         |               |                             |                    |          |
| Abuse/safety monitoring           |                        |                  |          |         |               |                             |                    |          |
| Application state                 |                        |                  |          |         |               |                             |                    |          |
| Batch                             |                        |                  |          |         |               |                             |                    |          |
| Files                             |                        |                  |          |         |               |                             |                    |          |
| Cached input/prompt cache         |                        |                  |          |         |               |                             |                    |          |
| Error/diagnostic capture          |                        |                  |          |         |               |                             |                    |          |
| Customer-enabled sharing/feedback |                        |                  |          |         |               |                             |                    |          |
| Backups/disaster recovery         |                        |                  |          |         |               |                             |                    |          |
| Legal/safety exception            |                        |                  |          |         |               |                             |                    |          |

Record explicitly whether the selected OpenAI project has approved/compatible Modified Abuse Monitoring or Zero Data Retention; whether the Azure deployment uses Global, Data Zone, or Regional processing and the actual abuse-monitoring configuration; or whether the selected Bedrock model/mode and inference profile enforce the required retention/geography. These are examples of provider-specific proof, not defaults. See the dated [provider snapshot](../ai-governance-primary-sources-2026-07-14.md#8-dated-provider-snapshot).

## 5. Full-path regional map

| Data-path component          | Location(s) | Provider/subprocessor | Control preventing broader routing | Transfer/contract reference | Evidence |
| ---------------------------- | ----------- | --------------------- | ---------------------------------- | --------------------------- | -------- |
| RepKey canonical raw storage |             |                       |                                    |                             |          |
| Queue/job temporary state    |             |                       |                                    |                             |          |
| Network gateway              |             |                       |                                    |                             |          |
| Inference                    |             |                       |                                    |                             |          |
| Provider application state   |             |                       |                                    |                             |          |
| Provider abuse monitoring    |             |                       |                                    |                             |          |
| System/usage metadata        |             |                       |                                    |                             |          |
| Human/support access         |             |                       |                                    |                             |          |
| Subprocessors                |             |                       |                                    |                             |          |
| Backups/DR                   |             |                       |                                    |                             |          |
| Capacity/failure routing     |             |                       |                                    |                             |          |

## 6. Security and operations review

### Identity and network

- [ ] Workload identity/service principal/IAM role is used instead of shared human credentials where supported.
- [ ] Credentials are deployment/cell scoped, encrypted, rotated and inaccessible to browser/client code.
- [ ] Least-privilege permissions and administrative separation are documented.
- [ ] Private networking/egress allowlisting is assessed; any decision not to use it has a rationale.
- [ ] Endpoint/region/deployment mismatch is detectable and alertable.

### Telemetry and incident response

- [ ] Provider and RepKey logs exclude prompt/review/reply/reviewer content.
- [ ] Invocation metadata includes operation, deployment, region, policy, consent, redaction, token/cost/latency and result class.
- [ ] Provider status, quota, latency, 429/5xx/timeout and safety-denial monitoring is defined.
- [ ] Incident contacts, notification terms, evidence preservation and capability kill switch are tested.
- [ ] Provider configuration drift and assessment expiry produce alerts and prevent new calls.

### Service lifecycle

- [ ] Model alias/version behavior and change/deprecation notices are documented.
- [ ] No automatic fallback to an unassessed model/provider/deployment exists.
- [ ] Portability/exit plan covers prompts/schemas/evaluations without exporting prohibited real content.
- [ ] Provider-held state can be inventoried and deleted.
- [ ] A manual/non-AI fallback exists for every user workflow.

## 7. Comparative evaluation

Only hard-gate-eligible deployments enter this table. Use the same synthetic/anonymized task corpus, fixed schemas, concurrency profile, timeout budget and scoring method.

### Weighting proposal

| Dimension                                     | Weight | Minimum gate before weighted score |
| --------------------------------------------- | -----: | ---------------------------------- |
| Sentiment/category structured-output quality  |    15% | Meets task-specific baseline       |
| Reply-draft quality and instruction adherence |    15% | Human-review acceptance baseline   |
| PII/redaction compatibility and safety        |    20% | Redaction/output leakage gate      |
| Regional/privacy/retention posture            |    15% | All hard gates pass                |
| Interactive and background latency            |    10% | Phase-specific SLO feasible        |
| Reliability, quotas and burst recovery        |    10% | Target-load test feasible          |
| Operability, observability and change control |    10% | Required evidence available        |
| Cost predictability                           |     5% | Budget model complete              |

Privacy/security eligibility is primarily a hard gate; the weighted regional/privacy score compares already-eligible options and must not compensate for a failed control.

### Results

| Candidate deployment | Task quality | Safety/redaction | Region/privacy | Latency | Reliability | Operations | Cost | Weighted score | Notes |
| -------------------- | ------------ | ---------------- | -------------- | ------- | ----------- | ---------- | ---- | -------------- | ----- |
|                      |              |                  |                |         |             |            |      |                |       |

Attach raw aggregate measurements and evaluator rubric. Do not attach real reviews or prompts to the repository.

## 8. Risk and exception register

| Risk/exception | Affected gate/capability/region | Severity | Compensating control | Owner | Expiry | Reassessment trigger | Approval |
| -------------- | ------------------------------- | -------- | -------------------- | ----- | ------ | -------------------- | -------- |
|                |                                 |          |                      |       |        |                      |          |

Hard denials in ADR 0031—cross-property summary, automatic reply publication, provider training, and workforce review gamification—cannot be waived through this register.

## 9. Approval record

| Reviewer                        | Name | Decision | Date | Evidence/signature reference |
| ------------------------------- | ---- | -------- | ---- | ---------------------------- |
| Engineering                     |      |          |      |                              |
| Security                        |      |          |      |                              |
| Privacy/legal, where applicable |      |          |      |                              |
| Operations                      |      |          |      |                              |
| Product                         |      |          |      |                              |

Final deployment state: `approved / rejected / conditional`  
Allowed processing cells:  
Allowed capabilities:  
Approval version:  
Approval expiry:  
Rollback/kill-switch owner:

## 10. Reapproval triggers

Reassess immediately when the provider, contracting entity, DPA/subprocessor list, model/family, endpoint, request mode, deployment SKU/profile, region/zone, retention/logging/abuse-monitoring mode, human-access behavior, application-state feature, failover, transfer mechanism, or RepKey capability/data class changes.

While active, verify public documentation and executable configuration before each material AI release and at least quarterly. Suspend approval when evidence expires or behavior cannot be proved.
