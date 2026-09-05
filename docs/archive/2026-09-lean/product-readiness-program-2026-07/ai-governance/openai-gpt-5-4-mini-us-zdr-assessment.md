# OpenAI Responses / GPT-5.4 mini US ZDR Assessment

**Assessment ID:** `openai-responses-gpt-5-4-mini-2026-03-17-us-zdr-v1`  
**Status:** Reviewing — hard gates not proved; deployment rejected for runtime until approval  
**Assessed:** 2026-08-15  
**Owners:** Privacy, security, engineering, operations, product  
**Template:** [AI provider assessment](ai-provider-assessment-template.md)

This record assesses one exact intended deployment. It does not approve OpenAI generally. Public documentation establishes product capabilities; it cannot prove RepKey's contract, account/project controls, credentials, network route, or runtime configuration.

## 1. Assessment identity

| Field                           | Exact intended value / current evidence                                                                                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider and contracting entity | OpenAI; exact contracting entity and applicable signed terms/DPA are not present in repository evidence                                                                           |
| Service/product                 | OpenAI API, `/v1/responses` only                                                                                                                                                  |
| Model/family                    | Exact snapshot `gpt-5.4-mini-2026-03-17`; moving aliases forbidden                                                                                                                |
| SDK and HTTP transport          | Exact locks `openai@7.4.0` and `undici@8.10.0`; mechanically checked by `check:ai-contract-attestations`; scoped dispatcher forces HTTP/1.1 for byte-exact, one-request isolation |
| Request mode                    | Synchronous, non-streaming, `background:false`, strict Structured Output, no tools/files/search/conversation/metadata                                                             |
| Reasoning/service tier          | `xhigh`; `default`                                                                                                                                                                |
| RepKey project/resource         | Dedicated US data-residency project required; project ID/configuration evidence absent                                                                                            |
| Processing cell                 | `us` only                                                                                                                                                                         |
| Provider host                   | Compiled `us.api.openai.com`; no environment/caller override and no redirect/fallback                                                                                             |
| Retention posture               | Project-level Zero Data Retention required; `store:false`; compatible in-memory prompt-cache posture must be proved for the exact project/model/request                           |
| Intended capabilities           | `review_analysis`, `reply_drafting`, `property_trends`                                                                                                                            |
| Input classes                   | Minimized/redacted single-review facts for analysis/drafting; aggregate-only deterministic candidates for trends                                                                  |
| Output classes                  | Strict derivative metadata, one untrusted reply suggestion, or bounded aggregate narrative; no reasoning/rationale persisted                                                      |
| Approval expiry                 | Not assigned; no approval exists                                                                                                                                                  |

## 2. Frozen request profile

```text
provider = OpenAI
service = Responses API
model = gpt-5.4-mini-2026-03-17
reasoning.effort = xhigh
service_tier = default
base_host = us.api.openai.com
store = false
prompt_cache_retention = in_memory, only if exact ZDR compatibility is proved
stream = false
background = false
tools = none
conversation = absent
previous_response_id = absent
metadata = absent
fallback = none
```

The gateway must reject any profile drift. A provider/model/region fallback is not an availability mechanism.

## 3. Public-source findings

Checked 2026-08-15 against official OpenAI documentation:

- The [GPT-5.4 mini model page](https://developers.openai.com/api/docs/models/gpt-5.4-mini) identifies current snapshot `gpt-5.4-mini-2026-03-17`, reasoning effort through `xhigh`, the Responses endpoint, and Structured Outputs.
- [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data) state that API data is not used to train models unless the customer explicitly opts in; default abuse-monitoring logs may include customer content and are retained up to 30 days.
- The same data-controls page states that eligible approved customers can configure project-level Zero Data Retention, which excludes customer content from abuse-monitoring logs and forces `store:false` behavior for Responses. Approval, configuration, and documented exceptions remain customer/project-specific.
- The [regional support table](https://developers.openai.com/api/docs/guides/your-data#support-by-region) lists `us.api.openai.com` with US regional storage and processing and lists `/v1/responses` and Structured Outputs among supported services.
- The [Responses create reference](https://developers.openai.com/api/reference/resources/responses/methods/create) defines request controls including model, reasoning, `store`, service tier, tools, streaming, background, conversation/previous-response state, safety identifier, and prompt-cache options.

These findings establish feasibility only. They are not account configuration evidence and do not satisfy the hard gates below.

## 4. Hard gates

`not proved` is a release failure.

| Gate                                                                                                 | Status         | Evidence/finding                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1 — contract/DPA/entity/instructions/confidentiality/security/subprocessors/deletion/incident/audit | **not proved** | No signed/applicable contract, DPA, entity schedule, or subprocessor acceptance is present                                                              |
| G2 — transfers and support locations                                                                 | **not proved** | Public US endpoint support is documented; transfer mechanism and support/subprocessor locations are not approved                                        |
| G3 — no training/secondary use; sharing disabled                                                     | **not proved** | Public default is no training unless opt-in; exact org/project sharing and feedback settings have no exported evidence                                  |
| G4 — exact retention across abuse logs/state/cache/errors/backups/exceptions                         | **not proved** | Public default and ZDR behavior are documented; exact ZDR approval, prompt-cache compatibility, safety exceptions, and project configuration are absent |
| G5 — minimum acceptable retention enforced                                                           | **not proved** | Required project-level ZDR has not been evidenced                                                                                                       |
| G6 — human/provider access                                                                           | **not proved** | Eyes Off/Safety Retention and support/reviewer access disposition not accepted                                                                          |
| G7 — full-path US location                                                                           | **not proved** | Endpoint capability is documented; metadata, support, subprocessors, backups, and failover are not proved                                               |
| G8 — broader fallback technically denied                                                             | **not proved** | Required compiled-host gateway and network controls are not implemented                                                                                 |
| G9 — encryption/identity/least privilege/rotation/isolation/audit/incident                           | **not proved** | Runtime services, credentials, and target-environment evidence do not exist                                                                             |
| G10 — content logging disabled/bounded                                                               | **not proved** | Required provider project settings and RepKey telemetry marker proof do not exist                                                                       |
| G11 — model/endpoint/schema/content/language/safety/cancellation behavior                            | **not proved** | Public model capabilities pass feasibility; pinned SDK request/response and adversarial eval evidence are absent                                        |
| G12 — stateful features disabled                                                                     | **not proved** | Intended profile disables them; runtime/configuration proof absent                                                                                      |
| G13 — change notice/availability/rate limits/quota/exit                                              | **not proved** | No commercial quota, escalation path, notice acceptance, or load evidence                                                                               |
| G14 — exportable invoked-deployment evidence                                                         | **not proved** | No control-plane attestation or runtime deployment exists                                                                                               |
| G15 — compatibility with Google's case-specific conditions                                           | **not proved** | Architecture is designed to comply; legal/privacy/security acceptance and executable proof are absent                                                   |

### Hard decision

| Decision                             | Value                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| Eligible for comparative evaluation? | **No**                                                                                     |
| Runtime disposition                  | **Denied / dark**                                                                          |
| Rejected/conditional gates           | G1–G15 remain not proved                                                                   |
| Conditions before approval           | Complete the evidence ledger in §8 and obtain all five role approvals after final evidence |

## 5. Data-use and retention matrix

| Feature/mode                    | Intended behavior                                                                                                    | Current proof status                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Synchronous Responses inference | Minimized request processed in US; no application-state storage under approved ZDR                                   | Public feasibility only; exact project not proved        |
| Abuse/safety monitoring         | Customer content excluded under approved ZDR, subject to documented safety/legal exceptions                          | ZDR approval/config and exception acceptance absent      |
| Application state               | `store:false`; no conversation, previous response, background, file, or vector-store state                           | Intended profile only                                    |
| Batch                           | Forbidden; not used                                                                                                  | Architectural decision; runtime boundary not implemented |
| Files/search/tools              | Forbidden; not used                                                                                                  | Architectural decision; runtime boundary not implemented |
| Prompt cache                    | `in_memory` only when exact project/model ZDR compatibility is proved; otherwise disable and reassess                | Not proved                                               |
| Error/diagnostic capture        | Code/status/request-ID metadata only; no prompt/output/reasoning                                                     | Provider/RepKey configuration and marker evidence absent |
| Sharing/feedback/training       | All optional sharing disabled; no training                                                                           | Exact project export absent                              |
| Backup/DR                       | No provider application state expected for permitted mode; contractual/system metadata behavior still requires proof | Not proved                                               |
| Legal/safety exception          | Only accepted documented ZDR/Eyes Off/Safety Retention behavior                                                      | Not accepted                                             |

## 6. Full-path regional disposition

| Component                                       | Intended location/control                          | Status                                                |
| ----------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------- |
| Canonical raw storage                           | RepKey US property cell; Review owner only         | Existing source governance; AI-specific proof pending |
| Jobs/queues                                     | Identifier/version envelopes only; no content      | AI implementation absent                              |
| AI gateway                                      | US cell; fixed mTLS identity and fixed OpenAI host | Absent                                                |
| Inference                                       | `us.api.openai.com`, exact pinned profile          | Project and runtime absent                            |
| Provider state/abuse monitoring                 | ZDR project required                               | Not proved                                            |
| Metadata/support/subprocessors/backups/failover | Must satisfy approved US full-path map             | Not proved                                            |

No customer-facing US-residency claim may rely on the endpoint row alone.

## 7. Security, operations, and evaluation state

All provider-runtime checklist items remain open: workload identity, secret isolation/rotation, gateway egress policy, deployment/config attestation, response limits, retries disabled, code-only errors, prompt/output log denial, drift alerts, quota/circuit controls, kill/drain, deletion/reconciliation, image/SBOM/scans, and non-AI fallback verification.

Comparative quality/cost scoring has not started because hard eligibility failed. Only synthetic or irreversibly anonymized corpora may be used. Real reviews/prompts/provider outputs must not enter repository evidence.

## 8. Required evidence ledger

| Evidence                                                                                                                   | Owner                              | State                                  |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------- |
| Applicable signed agreement/DPA/entity/subprocessor/transfer record                                                        | Privacy/legal                      | Pending external evidence              |
| Exact project ID plus dated export proving US residency, ZDR, no sharing/feedback/training, and accepted exception posture | Privacy + operations               | Pending external evidence              |
| Commercial quota/rate-limit/escalation/status/deprecation contacts                                                         | Product + operations               | Pending external evidence              |
| Gateway/admission network, identity, credential, config-attestation, kill/drain, and no-fallback proof                     | Security + engineering             | Pending implementation                 |
| Exact `openai@7.4.0` / `undici@8.10.0` pins, HTTP/1.1 isolation, request-shape, and error/body-limit contract tests        | Engineering                        | Implemented; release evidence required |
| `gbp-review-en-v1` corpus digest and leakage/injection/false-positive acceptance                                           | Privacy + security + product       | Pending implementation/evaluation      |
| Target-environment content-negative logs/traces/queues/stores/artifacts proof                                              | Security + operations              | Pending implementation                 |
| Cost/latency/quality/load and failure-mode evidence                                                                        | Product + engineering + operations | Pending implementation                 |
| Deletion/revocation/restore/ambiguous-operation evidence                                                                   | Privacy + engineering + operations | Pending implementation                 |

## 9. Approval record

| Reviewer      | Decision    | State                                                                  |
| ------------- | ----------- | ---------------------------------------------------------------------- |
| Engineering   | No decision | Awaiting final implementation evidence                                 |
| Security      | No decision | Awaiting provider and implementation evidence                          |
| Privacy/legal | No decision | Awaiting contract/DPA/transfer/subprocessor and configuration evidence |
| Operations    | No decision | Awaiting target-environment evidence                                   |
| Product       | No decision | Awaiting quality/cost/UX/notice evidence                               |

**Final deployment state:** rejected until re-reviewed  
**Allowed processing cells:** none  
**Allowed capabilities:** none  
**Approval version/expiry:** none  
**Rollback/kill-switch owner:** operations role; named owner required before activation

Reassess immediately on any provider, entity, contract, DPA, subprocessor, endpoint, model snapshot, SDK request shape, region, ZDR/logging/cache mode, tool/state feature, failover, capability/data class, or Google disposition change. While active, revalidate public documentation and executable configuration before each material release and at least quarterly.
