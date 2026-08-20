# GBP Review PII-Redaction Specification

**Status:** Proposed; privacy, security, product, and engineering acceptance required  
**Profile:** `gbp-review-en-v1`  
**Effective version:** not active  
**Owners:** Privacy, security, product, engineering  
**Scope:** Real Google Business Profile review text used for property-scoped review analysis or manager-requested reply drafting

This specification is a release contract, not evidence that the detector is implemented or effective. No real review may leave RepKey until the profile is accepted, implemented, and proven by the gates below.

## 1. Hard boundary

The initial profile supports only an exact Google language code of `en`. Null, unknown, inferred, or any other language returns `unsupported_language` before provider admission. Translation is not a fallback.

The Review bounded context is the sole raw-content owner. It must remove structured reviewer name, profile photo, Google review identifiers, provider resource names, external identifiers, and content hashes before constructing an AI observation. The AI context never receives those fields.

The remaining text is untrusted source data. It cannot select a provider, endpoint, model, tool, prompt, schema, property, capability, or publication action. The only permitted external destination is an independently approved provider deployment selected from current server-side policy.

## 2. Data minimization by capability

| Capability               | Permitted input                                                                                         | Forbidden input                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `review_analysis`        | One property's current rating, exact `en` language code, and one minimized/redacted current review body | Reviewer identity, Google/external IDs, property name, prior reviews, prior replies, organization data, cross-property data            |
| `reply_drafting`         | The same current review facts plus one explicit tone: `professional`, `friendly`, or `casual`           | Property name, contact details, previous replies, current-reply examples, promises/compensation policy, unrelated tenant configuration |
| `property_trends`        | Deterministic property-local aggregate candidates and opaque signal IDs only                            | Raw review text, excerpts, reviewer facts, Google IDs, reply text, reversible hashes, per-review source identifiers                    |
| `historical_backfill`    | None                                                                                                    | All input; capability denied in v1                                                                                                     |
| `current_reply_examples` | None                                                                                                    | All input; capability denied in v1                                                                                                     |

Review analysis and reply drafting accept one review only. There is no bulk raw-content port in v1.

## 3. Processing pipeline

The pipeline order is fixed. Reordering or skipping a step changes the profile and requires reapproval.

1. **Atomic source read.** Query by organization, property, review, source epoch, source revision, and `content_expires_at > now` in one predicate.
2. **Structured stripping.** Remove all structured identity and provider fields in the Review owner. Remove exact occurrences of the structured reviewer name from text before releasing the observation.
3. **Language gate.** Require exact source language `en`; never infer or translate.
4. **Bounded normalization.** Reject an input exceeding 16 KiB of UTF-8 before normalization. Apply Unicode NFKC, normalize line endings, replace C0/C1 controls and bidi-formatting characters with spaces, and collapse repeated horizontal whitespace. Reject invalid Unicode rather than repairing it silently.
5. **Local detection and replacement.** Detect the classes in §4 using only the approved in-process detector. Replace each match with a constant typed placeholder. Do not retain a value-to-placeholder map.
6. **Post-redaction bounds.** Require non-empty output and at most 16 KiB of UTF-8. Reject uncertain, conflicting, or limit-exhausted detection as `redaction_blocked`; do not truncate.
7. **Pre-send leakage scan.** Immediately before external send, the AI gateway repeats the prohibited-field/marker scan over the complete normalized request. Any marker or raw prohibited value denies the call.
8. **Instruction isolation.** Place redacted content in one quoted user-data block beneath immutable versioned developer instructions. Disable tools, streaming, background mode, conversation state, previous-response state, and arbitrary metadata.
9. **Output validation.** Parse the strict operation schema, normalize the text fields, then run the same PII/secret detector and prohibited-marker scan. Any uncertain or positive output result invalidates the whole response as `output_invalid`; no partial field is returned or persisted.
10. **Post-return authorization.** Revalidate source revision/epoch, opt-in epoch, routing profile, deployment approval, and policy before delivery or persistence. Discard bytes on any mismatch.

Transient raw, normalized, redacted, provider-response, and reasoning buffers are request-local and released after the terminal outcome. They never enter jobs, Redis, logs, traces, metrics, audit records, quarantine payloads, error messages, test artifacts, or backups.

## 4. Mandatory detector classes

Use constant, non-numbered placeholders so the output cannot reconstruct identity relationships.

| Class                 | Required examples                                                                    | Placeholder                |
| --------------------- | ------------------------------------------------------------------------------------ | -------------------------- |
| Email                 | RFC-like addresses and obfuscated common forms                                       | `[REDACTED_EMAIL]`         |
| Phone                 | International/national numbers, extensions, messaging numbers                        | `[REDACTED_PHONE]`         |
| URL/host              | URLs, domains, invite links, QR/deep-link text                                       | `[REDACTED_URL]`           |
| Social handle         | `@` handles and platform-qualified handles                                           | `[REDACTED_HANDLE]`        |
| Network address       | IPv4, IPv6, MAC-like values                                                          | `[REDACTED_NETWORK]`       |
| Coordinates           | Decimal/DMS latitude-longitude pairs                                                 | `[REDACTED_COORDINATES]`   |
| Payment/financial     | Payment cards, IBAN/account/routing identifiers, wallet addresses                    | `[REDACTED_FINANCIAL]`     |
| Government identifier | National IDs, tax IDs, passport/driver-license patterns                              | `[REDACTED_GOVERNMENT_ID]` |
| Postal address        | Street/unit/postal-code patterns and precise delivery locations                      | `[REDACTED_ADDRESS]`       |
| Secret/token          | API keys, bearer tokens, credentials, private keys, high-entropy secret-like strings | `[REDACTED_SECRET]`        |
| Person name           | Structured reviewer-name occurrences and conservative local person-name spans        | `[REDACTED_PERSON]`        |

Detection must be Unicode-aware and cover punctuation/whitespace substitutions used to evade simple regular expressions. A deterministic pattern may handle bounded high-confidence forms. Person-name detection is conservative and local. If the approved corpus cannot meet the hard gates with the in-process detector, release stops; the only permitted escalation is a separately assessed no-egress local NER service.

OpenAI or another external provider must never be used to redact its own input.

## 5. Prompt-injection and leakage controls

Redaction is not a prompt-injection defense by itself. The gateway must independently enforce:

- repository-defined operations only; no generic prompt or URL method;
- compiled provider host, pinned model snapshot, strict schema, fixed instructions, fixed limits, and no fallback;
- no tools, file/search capability, remote MCP, code execution, or provider-side conversation state;
- redacted source text treated as quoted data, including text that claims to be system/developer instructions;
- schema-close parsing with no free-form rationale for analysis;
- a second output leakage scan; and
- manual, separately authorized Google publication for every reply.

A review instruction must be unable to change the schema, route, model, tools, organization/property scope, persistence, or publication behavior.

## 6. Evaluation corpus and release thresholds

The versioned corpus contains synthetic or irreversibly anonymized English examples only. It must include ordinary reviews, short/long boundaries, multilingual-confusable text, emoji, malformed Unicode, every detector class, overlapping classes, obfuscation, prompt injection, secret markers, output reconstruction attempts, and benign phrases likely to trigger false positives. Real reviews, prompts, and provider responses are not committed as fixtures.

All of these are hard gates:

- zero structured reviewer identity, provider identifier, or prohibited field leakage;
- zero critical PII, credential, or secret marker leakage at pre-send;
- zero output PII echo or reconstruction across adversarial cases;
- 100% denial for null, unknown, inferred, or non-`en` languages;
- 100% denial on detector uncertainty, resource exhaustion, malformed Unicode, or byte-cap violation;
- no prompt injection changes schema, route, model, tools, property scope, persistence, or publication behavior;
- deterministic output for the same profile/version and input; and
- false-positive rate measured on the versioned benign set and explicitly accepted by privacy and product. No unrecorded threshold or aggregate score is sufficient.

A single critical leakage is a release failure. Tests must inspect all persistence and telemetry destinations with marker values, not only the returned DTO.

## 7. Evidence record

Each candidate records, without content:

- corpus version/digest and generator provenance;
- redaction profile version/digest;
- detector dependency/version inventory;
- case counts by detector class and adversarial family;
- false-negative, false-positive, unsupported-language, injection, output-leakage, and resource-bound results;
- changed cases since the previous profile;
- privacy, security, product, and engineering decisions after final evidence; and
- exact release SHA, service-image digests, provider-deployment approval version, and expiry.

Evidence contains counts, digests, bounded code-only failures, and synthetic case IDs only. It contains no source text, normalized text, redacted text, prompts, outputs, or reversible fingerprints.

## 8. Change and stop rules

A new language, detector class, normalization rule, placeholder scheme, byte cap, local NER dependency, capability input, provider, model, prompt family, or output schema requires a new profile version and rerun of every affected gate.

Suspend the profile immediately on leakage, configuration/evidence drift, provider-deployment suspension, unsupported source shape, or an expired approval. Suspension blocks only AI; Google sync, Inbox work, manual reply drafting, and separately authorized publication remain available.
