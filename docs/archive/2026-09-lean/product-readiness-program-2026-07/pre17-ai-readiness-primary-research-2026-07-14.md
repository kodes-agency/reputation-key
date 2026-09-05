# PRE17 AI-readiness: primary-source findings

Checked: 2026-07-14  
Target: 5,000 properties and 500,000 new reviews per month  
Decisions already made: a dedicated PRE17 phase; routing is property-region based; AI summaries and trend reports are property-scoped.

Google disposition: [written support response conditionally permits the submitted per-property AI architecture](google-business-profile-ai-policy-response-2026-07-14.md).

This note records the external constraints that should shape PRE17. It is not legal advice. Statements marked **Inference** are implementation conclusions drawn from the cited sources rather than requirements stated verbatim by a source.

## Executive findings

1. **PostgreSQL must be the reliability boundary.** Persist a state change and its outbox event in one transaction; relay committed events to BullMQ; make every consumer idempotent. BullMQ deduplication is an optimization, not the source of correctness.
2. **Google's written response resolves the external policy gate for the submitted architecture.** Per-property sentiment, scores, categories, themes, trends, summaries, external AI processing, and manager-reviewed reply drafting are conditionally permitted. Raw content must be refreshed or removed under the applicable 30-day policy; derived metadata is not subject to that same limit. PRE17 must translate the conditions into ADR 0031 and executable controls before release.
3. **Region routing needs explicit product data.** GBP's `storefrontAddress.regionCode` is suitable for deriving a property's country, but it is not customer consent and does not itself select a lawful processing region. Persist country, IANA time zone, and an explicit processing-region policy per property.
4. **AI execution needs separate interactive, near-real-time, and batch capacity.** BullMQ's scheduler and rate-limiter behavior makes a shared queue unsuitable for both a reply-drafting latency target and historical/trend work.
5. **Commercial budget, provider throughput, and actual usage are three different controls.** Provider RPM/TPM limits do not enforce per-organization allowances. Reserve an internal budget atomically before dispatch, then settle it from the provider's returned usage.
6. **Do not partition or materialize by instinct.** At this workload, correct composite indexes, cursor scans, daily property aggregates, and measured query plans should come first. Partition append-only histories only when retention or measured table size justifies it.
7. **Telemetry must exclude review and prompt content.** Adopt OpenTelemetry's messaging and GenAI names where useful, pin the convention version because both areas are still evolving, and add product SLO metrics that the generic conventions do not provide.

## 1. Durable event delivery and idempotency

AWS's transactional-outbox pattern describes the exact dual-write failure PRE17 must eliminate: if a database change commits but notification fails, downstream state becomes inconsistent; if notification succeeds and the database transaction fails, consumers act on a change that did not commit. The recommended relational design writes the entity and an outbox row in the same transaction, then a separate relay publishes committed rows. The same guidance explicitly warns that duplicate delivery remains possible and consumers must track processed messages and be idempotent. [AWS transactional outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)

PostgreSQL documents `FOR UPDATE SKIP LOCKED` as inappropriate for a general consistent read but specifically useful for multiple consumers of a queue-like table. [PostgreSQL `SELECT` locking clause](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE)

**PRE17 constraints**

- The domain write and outbox insert must use the same PostgreSQL transaction and connection.
- The outbox carries identifiers and versioned facts, not raw review text, reviewer names, prompts, or generated replies.
- Give every event an immutable event ID, aggregate ID, aggregate version, event type/version, occurrence time, availability time, attempt count, and publish state.
- Relay workers claim a small ordered batch with `FOR UPDATE SKIP LOCKED`; an index must support the unpublished/available ordering. A partial index is appropriate only when the relay query's predicate matches the index predicate, which PostgreSQL requires for use of a partial index. [PostgreSQL partial indexes](https://www.postgresql.org/docs/current/indexes-partial.html)
- Mark an outbox row published only after BullMQ acknowledges the enqueue. A crash after enqueue and before marking published will enqueue again; that is expected at-least-once behavior.
- Consumers must insert a `(consumer_name, event_id)` receipt or perform an equivalent unique, transactional state transition before/with side effects. External calls need their own idempotency key or a persisted execution state machine.
- Preserve per-aggregate ordering with an aggregate version and reject or defer stale/out-of-order transitions where order matters. Do not claim total ordering across unrelated properties.
- Keep failed events inspectable and replayable. Purge payload data according to its source retention policy; retain only non-content operational metadata where permitted.

BullMQ's custom job IDs can suppress an enqueue while the same ID remains in that queue, but a removed completed/failed job no longer counts as a duplicate. Therefore a BullMQ job ID cannot replace the database receipt. [BullMQ job IDs](https://docs.bullmq.io/guide/jobs/job-ids) BullMQ likewise defines idempotence as reaching the same final state whether a job succeeds first time or after a retry, and recommends small, atomic jobs. [BullMQ idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs)

**Inference:** Use the immutable outbox event ID as the BullMQ job ID where one event maps to one job, but keep the database consumer receipt authoritative. For “latest state wins” refresh work, use BullMQ deduplication only to collapse redundant executions, while the worker always loads current state from PostgreSQL.

## 2. BullMQ execution model

The repository uses BullMQ 5.75.2. BullMQ deprecated repeatable-job APIs from 5.16 in favor of Job Schedulers. `upsertJobScheduler` avoids duplicate scheduler definitions, but a scheduler only produces the next job when the previous job starts processing; a busy queue or insufficient workers can therefore make the actual cadence slower than the configured cadence. [BullMQ Job Schedulers](https://docs.bullmq.io/guide/job-schedulers), [deprecated repeatable jobs](https://docs.bullmq.io/guide/jobs/repeatable)

BullMQ supports I/O concurrency within a worker and recommends multiple worker processes for availability. Its queue limiter is global across all workers for a queue; free BullMQ removed per-group limiter keys in v3. [BullMQ worker concurrency](https://docs.bullmq.io/guide/workers/concurrency), [BullMQ rate limiting](https://docs.bullmq.io/guide/rate-limiting)

Retries support fixed or exponential backoff and jitter. Unrecoverable failures can bypass retries. A provider 429 can be turned into a manual queue rate limit, while its retry delay should respect the provider's response. [BullMQ retrying jobs](https://docs.bullmq.io/guide/retrying-failing-jobs), [BullMQ stop-retrying pattern](https://docs.bullmq.io/patterns/stop-retrying-jobs)

`worker.close()` stops taking new work and waits for active jobs, but has no built-in timeout. Ungraceful termination can mark work stalled and cause another worker to process it again. CPU starvation can also prevent lock renewal and replay a stalled job. [BullMQ graceful shutdown](https://docs.bullmq.io/guide/workers/graceful-shutdown), [BullMQ stalled jobs](https://docs.bullmq.io/guide/workers/stalled-jobs) BullMQ does not impose a job timeout; its documented pattern uses an `AbortController` and explicit timer around abortable work. [BullMQ timeout pattern](https://docs.bullmq.io/patterns/timeout-jobs)

**PRE17 constraints**

- Use distinct queues/worker pools for: interactive reply suggestions; new-review analysis; historical backfill; and scheduled property trend/report work. This provides independent priority, concurrency, limiter, retention, and alerting policies.
- Keep all job payloads identifier-only. Workers re-authorize/reload current property and review state before doing work.
- Classify failures: retry transient network/429/5xx with bounded exponential backoff and jitter; fail fast on validation, unsupported region, deleted source, disabled feature, or permanent policy failures.
- Add an explicit provider-call abort timeout and a deployment shutdown deadline. A shutdown that exceeds the deadline may replay work, so all writes and quota settlement must remain idempotent.
- Use multiple worker processes for high availability. Tune local concurrency for network-bound provider calls, then cap it with provider/deployment rate limits rather than CPU count alone.
- Monitor deduplicated, retried, stalled, delayed, failed, and oldest-waiting work. BullMQ exposes OpenTelemetry integration and queue/job counters, duration, and queue-state gauges. [BullMQ telemetry](https://docs.bullmq.io/guide/telemetry), [BullMQ OpenTelemetry metrics](https://docs.bullmq.io/guide/telemetry/metrics)
- API-originated enqueue attempts should fail within a bounded time if Redis is unavailable; BullMQ otherwise waits for reconnection unless `enableOfflineQueue: false` is used. Durable background dispatch should rely on the outbox relay retrying, not on keeping a web request open. [BullMQ Redis-unavailable pattern](https://docs.bullmq.io/patterns/failing-fast-when-redis-is-down)

**Inference:** Do not create 5,000 independent daily schedulers unless a Redis benchmark proves that this is operationally preferable. Use one or a few Job Schedulers to enqueue a “dispatch due properties” job; persist each property's `next_due_at` and time zone in PostgreSQL, select due rows with a cursor/lock, and enqueue deterministic property-report jobs. This preserves local-time scheduling without making Redis the schedule source of truth.

## 3. Google Business Profile policy and regional property data

Google's current Business Profile API policy says limited API content may be stored only to improve project performance, for no more than 30 calendar days, securely, and without manipulation or aggregation. It also says a third-party relationship must be easy to terminate and that disassociation must be available within seven business days. Review replies require the end-client's authorization, and automated changes cannot be triggered without the user's prior specific and express consent. [Google Business Profile API policies](https://developers.google.com/my-business/content/policies)

**Written disposition and implementation consequence:** Google Business Profile API Support permits sentiment, scores, categories, themes, trends, and summaries when generated independently for one Business Profile. It also permits external AI processing after PII removal, no-training assurance, minimum retention, and applicable regional privacy controls. Merchant opt-in is required and reply publication must remain a separate manager action; automatic AI posting is unsupported. Raw review text, star ratings, reviewer information, and replies remain under the applicable 30-day refresh/removal policy, while non-content derived metadata may follow a separate product/privacy retention schedule. PRE17 must still build source-specific enablement, raw/derived lineage, refresh/expiry, consent epochs, region routing, disconnect, and lifecycle machinery so AI can fail closed without disabling non-AI review management.

The Business Information API returns a `storefrontAddress.regionCode` using a CLDR country/region code; Google's own listing examples and filters expose this field. [Google location-data guide](https://developers.google.com/my-business/content/location-data) The Location resource defines `storefrontAddress` as a postal address, whose `regionCode` is required and not inferred; service-area-only businesses also have a required base-region code. [Google Business Profile Location resource](https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations)

**PRE17 constraints**

- Persist `country_code`, IANA `time_zone`, `processing_region_policy`, `processing_region_source`, and `processing_region_confirmed_at` per property.
- Treat Google's country code as a routing default only. A customer/admin decision or contract can override the processing policy; no code path may silently fall back from a required EU/US cell to a global or different-region deployment.
- Define an explicit “AI unavailable: region not configured/supported” result that leaves all non-AI functionality working.
- Route every execution from the property record, not from user location, organization headquarters, language, or worker deployment region.
- Remove structured reviewer identity and run bounded PII detection/redaction over review text before provider transfer; provider input must contain only fields required for the operation.
- Keep raw Google content and retained derived metadata in separate lifecycle classes. A long-lived derivative cannot embed excerpts, exact ratings, replies, reviewer identities, Google identifiers, or reversible content fingerprints.
- Re-evaluate routing immediately when a property's country or policy changes; never move existing content across regions as a side effect.
- Make “Generate reply” an explicit user action, return a suggestion into the existing human review workflow, and never publish it automatically.
- On source disconnect, property deletion, organization deletion, source expiry, or source deletion, cancel pending work and purge/scrub every linked copy and derivation according to the resolved source policy.

## 4. Untrusted review content and model output

OWASP describes indirect prompt injection as malicious instructions embedded in external content—including user reviews—that an LLM processes as data. It recommends defense in depth: separate instructions from data, validate inputs and outputs, use least privilege, retain human approval for high-impact actions, monitor, and adversarially test. It also warns that a guardrail model is itself probabilistic and cannot replace deterministic controls. [OWASP LLM Prompt Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)

Microsoft likewise classifies user messages as untrusted and says model output must be treated as untrusted because it may contain hallucinations or malicious payloads such as HTML/JavaScript, SQL, or shell content. [Microsoft Agent Framework safety guidance](https://learn.microsoft.com/en-us/agent-framework/agents/safety) Microsoft's indirect-injection guidance calls for layered deterministic and probabilistic mitigations because ordinary input validation alone is insufficient. [Microsoft indirect prompt-injection guidance](https://learn.microsoft.com/en-us/security/zero-trust/sfi/defend-indirect-prompt-injection)

NIST's GenAI profile frames privacy, security/resilience, validity/reliability, measurement, governance, and ongoing evaluation as lifecycle concerns rather than a one-time model choice. [NIST AI 600-1 GenAI Profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence)

**PRE17 constraints**

- The model gateway receives a typed task and untrusted data separately. Review text must never be concatenated into system instructions.
- AI workers have no publishing credential or general tool access. The only provider credential permits inference in the selected regional deployment.
- Apply input byte/token limits, Unicode normalization, and valid-language/field checks. Pattern filters may flag suspicious content but must not be treated as proof that content is safe.
- Require provider-supported structured output where available, then validate again against an application-owned schema, enum allowlists, numeric ranges, and maximum lengths. Reject unknown fields.
- Render suggestions as escaped plain text. Do not interpret model HTML/Markdown or execute returned URLs, tool calls, code, or SQL.
- Keep manual approval before a reply can be published. An urgent priority result may notify a user but must not perform a destructive or customer-visible action by itself.
- Version prompt, schema, model route, priority formula, and evaluation suite. Store hashes/identifiers and normalized result metadata, not prompt/review bodies in telemetry.
- Maintain adversarial regression cases: direct/indirect instruction override, system-prompt extraction, encoded/Unicode attacks, data exfiltration requests, oversized input, invalid JSON, unexpected fields, unsafe HTML, multilingual ambiguity, rating-only reviews, and provider refusal/content filtering.
- Provide a per-source and global AI kill switch that prevents new calls while leaving review ingestion, inbox, and manual replies operational.

## 5. Provider throughput, organization budgets, and usage settlement

Provider quota is infrastructure throughput, not a tenant entitlement. Azure documents quota by subscription, region, model, and deployment type, with RPM and TPM coupled; it also explains that request-time rate-limit estimates can differ from billed token usage and that bursty traffic can receive 429 responses below a simple per-minute average. [Azure OpenAI quota management](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/quota) Amazon Bedrock similarly applies model/account/region quotas, returns 429 for throttling, and recommends exponential backoff with jitter. [Bedrock quotas](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html), [Bedrock API error guidance](https://docs.aws.amazon.com/bedrock/latest/userguide/troubleshooting-api-error-codes.html)

Providers expose actual usage after inference: Bedrock Converse, for example, returns input, output, total, and cache token fields in `usage`. [Bedrock Converse response](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html)

**Inference: provider-neutral budget design**

- Maintain two independent controls:
  - a deployment limiter for provider RPM/TPM and 429 recovery;
  - an application entitlement/budget for organization/property/purpose consumption.
- Before dispatch, atomically create an idempotent execution and reserve a conservative maximum amount from the applicable budget period. A conditional `UPDATE ... WHERE available >= reservation RETURNING ...` or a consistently ordered row lock prevents concurrent overspend.
- After the provider response, settle the reservation to actual returned tokens/cost. Release it on a known no-charge failure; leave ambiguous/crashed reservations for a reconciliation job.
- Use one stable execution/idempotency key across enqueue retries, provider attempts, usage ledger entries, and settlement so one logical request cannot be charged twice.
- Store provider, model/deployment, region, purpose, input/output/cache token counts, latency, outcome/error class, and pricing-version metadata. Do not store prompt or completion content in the usage ledger.
- Version prices with effective timestamps; never recompute historical estimated cost from today's price.
- BullMQ's free global limiter cannot implement per-organization budgets because group-key limiting was removed. PostgreSQL budget state remains authoritative.
- Treat reply generation and automatic analysis differently when a budget is exhausted: return a clear, non-fatal product result for interactive requests; record a deferred/skipped state for automatic work; never break review ingestion or manual reply publishing.

## 6. PostgreSQL read models, indexes, partitioning, and migrations

PostgreSQL materialized views persist query results and can make reads much faster, but their data is not always current. `REFRESH MATERIALIZED VIEW` replaces the contents. `CONCURRENTLY` avoids blocking readers but requires a qualifying unique index, only works on a populated view, and allows only one refresh at a time per materialized view. [PostgreSQL materialized views](https://www.postgresql.org/docs/current/rules-materializedviews.html), [PostgreSQL materialized-view refresh](https://www.postgresql.org/docs/current/sql-refreshmaterializedview.html)

PostgreSQL says partitioning is normally worthwhile only for very large tables, with a rule of thumb that the table exceeds server memory. It helps when pruning limits queries to a few partitions or when retention can drop/detach whole partitions instead of bulk-deleting rows. [PostgreSQL table partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html) Covering indexes can support index-only scans but duplicate payload data and should be used conservatively, especially for wide/changing columns. [PostgreSQL covering indexes](https://www.postgresql.org/docs/current/indexes-index-only-scans.html)

**PRE17 constraints and inferences**

- Add stable cursor scan APIs; no historical or retention job may rely on a fixed maximum row count or offset pagination.
- Build dashboard queries around `property_id` and time. A daily property aggregate table updated idempotently is a better default for Phase 18 than repeatedly scanning all raw reviews or full-refreshing a broad materialized view.
- At 5,000 properties, a daily property aggregate adds at most about 1.825 million rows/year before retention. This is a normal indexed PostgreSQL workload; benchmark before partitioning it.
- If policy permits long-lived AI execution/usage metadata, 500,000 analyses/month implies up to 6 million execution rows/year before drafts, retries, and trends. Monthly range partitioning may become useful for retention and maintenance, but adopt it only after measuring row width, index size, query plans, and database memory. Design repository interfaces so partitioning can be added without changing the domain API.
- Candidate index shapes must be justified by real queries and `EXPLAIN (ANALYZE, BUFFERS)`. Likely starting points are property/time cursor indexes for reviews and analyses; a partial unpublished/available index for outbox relay; unique execution/idempotency indexes; and organization/period indexes for budget settlement. Exact definitions belong in the implementation plan after query inventory.
- Keep wide review text and model output out of covering indexes.
- Quota/reservation code must acquire multiple locks in a consistent order and retry PostgreSQL deadlock victims; PostgreSQL identifies consistent lock order as the primary defense. [PostgreSQL explicit locking and deadlocks](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-DEADLOCKS)

Drizzle documents a code-first production flow in which `generate` creates versioned SQL, `migrate` applies it, and `check` validates migration-history consistency. It also supports custom generated migration files for DDL that Drizzle Kit cannot express. [Drizzle migrations](https://orm.drizzle.team/docs/migrations), [Drizzle `generate` and custom migrations](https://orm.drizzle.team/docs/drizzle-kit-generate), [Drizzle `check`](https://orm.drizzle.team/docs/drizzle-kit-check)

**Migration gate**

- All tables, indexes, constraints, materialized views, functions, and partition DDL must be in one ordered, version-controlled migration history. Use custom Drizzle migrations rather than unjournaled sidecar SQL.
- CI must run `drizzle-kit check`, migrate a clean PostgreSQL database, and exercise an upgrade from the current production baseline. `push` is not a substitute for validating production migration files.
- Large/backfilled changes need expand/backfill/verify/contract steps, bounded batches, retry-safe checkpoints, and a measured lock/statement timeout. Do not combine a long content backfill with a blocking constraint change in one deployment.

## 7. OpenTelemetry and operational signals

OpenTelemetry's messaging metrics define separate client operation and consumer processing durations, plus sent/consumed counts. The messaging conventions are still marked development and include an explicit migration/opt-in strategy. [OpenTelemetry messaging metrics](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-metrics/) Its GenAI conventions currently recommend `gen_ai.client.operation.duration` and `gen_ai.client.token.usage`, but are also development status. [OpenTelemetry GenAI metrics](https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/gen-ai-metrics.md) GenAI input messages, output messages, and system instructions are opt-in attributes and are likely to contain sensitive content. [OpenTelemetry GenAI span model](https://github.com/open-telemetry/semantic-conventions/blob/main/model/gen-ai/spans.yaml)

**PRE17 constraints**

- Pin a semantic-convention/schema version and wrap instrumentation behind an internal adapter so convention renames do not leak through application code.
- Propagate trace context from HTTP/sync transaction to outbox, enqueue, consumer, and provider call. Model create/send/process and provider client spans separately where practical.
- Record provider/model/region/purpose, operation duration, token counts, attempt, and low-cardinality error class. Leave prompt, review, reply, reviewer identity, organization ID, property ID, and full provider errors out of metric labels.
- Keep content-capturing GenAI attributes disabled. Logs and traces use execution/event IDs to reach access-controlled database records when investigation is authorized.
- Add product metrics absent from generic conventions: oldest unpublished outbox age; enqueue delay; oldest waiting job age; review-persisted-to-analysis-completed latency; interactive reply end-to-end latency; structured-output rejection rate; provider 429/5xx/timeout rate; budget denial rate; unsettled reservation age; deletion backlog; and report freshness.
- Alert on SLO symptoms, not only process health. A healthy web/Redis/PostgreSQL check does not prove that outbox delivery, analysis, or deletion is progressing.

## 8. Privacy engineering and deletion

GDPR Article 5 requires purpose limitation, data minimization, accuracy, and storage limitation for personal data. [Official GDPR text, Article 5](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679) The European Data Protection Board states that data protection by design/default must cover the amount of data, extent of processing, storage limitation, and accessibility, and it identifies records of processing and DPIAs as relevant compliance mechanisms. [EDPB compliance guidance](https://www.edpb.europa.eu/sme/be-compliant/be-compliant_en)

California's official CCPA guidance identifies rights to delete and correct and says covered businesses must limit collection, use, and retention to reasonably necessary and proportionate purposes. It also notes that a business handling a deletion request must tell its service providers to delete, subject to exceptions. [California DOJ CCPA guidance](https://oag.ca.gov/privacy/ccpa), [CPPA purpose-limitation and minimization FAQ](https://cppa.ca.gov/faq)

**Implementation consequences, subject to counsel and customer contracts**

- Treat reviewer name/photo/text and review-linked inferences as potentially personal data. Build deletion by source lineage, not by knowing every downstream table in a UI handler.
- Every source, copy, derivation, cache entry, pending job, generated suggestion, report, and notification must be discoverable from organization/property/source-review identifiers and have an explicit retention class.
- A deletion/disconnect workflow must be durable, idempotent, observable, and retryable. It should first prevent new processing, then cancel/neutralize pending work, delete or irreversibly scrub content and derivations, invalidate caches, and record content-free evidence of completion.
- Keep legal/security exception data in a separate minimal tombstone/audit record with a documented basis and retention period; do not retain raw review text merely to prove deletion.
- Provider agreements and configuration must support the application's region, retention, subprocessor, security, and deletion commitments. PRE17 should capture these as deployment capabilities, not hard-code assumptions about one provider.
- Conduct a DPIA/privacy review before enabling automated sentiment/priority for EU properties, because the result is a systematic inference attached to an identifiable review context. This is a prudent engineering gate, not a conclusion that a DPIA is legally mandatory in every deployment.

## 9. Scale implications for 5,000 properties / 500,000 reviews per month

The stated load averages approximately 16,667 reviews/day, 694/hour, 11.6/minute, or 0.193/second, and 100 reviews/property/month. These averages are small for PostgreSQL and BullMQ; launch risk comes from synchronization bursts, regional/provider throttling, retry storms, and full-fleet scheduled work rather than steady-state throughput.

**Inferences to validate with load tests**

- Size for measured peak arrival and recovery rate, not `0.193/s`. The analysis pool must drain a realistic reconnect/import burst while protecting live-review and reply latency.
- Run at least: 10× average sustained arrival; a single-property burst; many properties reconnecting simultaneously; provider 429 with `Retry-After`; Redis restart; worker termination during provider call; outbox relay crash after enqueue; and a regional provider outage.
- Verify the gate “new review analyzed within 60 seconds” as end-to-end latency from review commit to terminal analysis state, using p95/p99 and backlog-age alerts. Provider latency alone is insufficient.
- Spread daily property reports using persisted local due times and bounded dispatch batches. Five thousand reports in one cron instant would create an avoidable thundering herd.
- Historical backfill must use cursor batches, low-priority isolated workers, resumable checkpoints, provider/budget admission, and a pause switch. It must yield capacity to live analysis.
- Load-test retention deletion over the maximum active Google window (up to roughly one month of reviews at current volume) and one year of non-content execution metadata if that retention is approved.

## 10. Evidence-based PRE17 exit gates

- Database change plus outbox event is atomic; automated fault injection proves no event loss across Redis outage, relay crash, and worker restart.
- Every migrated consumer is idempotent under duplicate and out-of-order delivery.
- BullMQ schedulers use the current Job Scheduler API; queues are workload-isolated; retries, timeouts, graceful shutdown, dead-letter/reconciliation, and OTel metrics are exercised.
- Source lineage and durable deletion cover reviews, inbox copies, jobs, caches, notifications, AI-ready records, and property/integration/organization teardown.
- Every property has country, validated IANA time zone, and explicit processing-region policy; prohibited cross-region fallback is tested.
- Migration history creates the full schema from empty and upgrades the production baseline in CI; no production object depends on unjournaled SQL.
- Cursor scans and dashboard/read-model queries are benchmarked at target volume; indexes are supported by recorded query plans.
- Budget reservation is race-tested and crash-reconciled; provider usage settlement cannot double-charge a logical execution.
- Telemetry demonstrates the 60-second analysis and interactive-reply latency paths without capturing review/prompt/reply content.
- Adversarial input/output tests and human-approval boundaries pass.
- Google's response is preserved and translated into accepted ADR 0031/source-policy configuration; tests prove per-property isolation, raw/derived separation, refresh-or-remove lifecycle, PII redaction, merchant opt-in/revocation, provider/region eligibility, and manual-only reply publication.
