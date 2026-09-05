# Closed-beta feature enablement — 2026-08-19

Found and fixed while importing `Hotel Elegance`
(`071b20fe-2598-4f63-a2a1-b9ac2f959575`, `europe`, tz `Europe/Sofia`) into
`google-closed-beta`. The import succeeded; six defects downstream of it meant
almost nothing the property should do actually worked. All six are fixed and
deployed. One step remains and it belongs to the owner: the per-property AI
opt-in.

## Live state after this work

| Surface               | State                                                                               |
| --------------------- | ----------------------------------------------------------------------------------- |
| Google approvals      | `property.import_gbp_v2`, `property.read_gbp_performance` — `2026-08-16 / approved` |
| AI control heads      | global, provider, and all three capabilities `enabled / accepting`                  |
| AI release canary     | `89bec3f1…` `passed`                                                                |
| Property capabilities | Urban Move 18, Hotel Elegance 18 (org set complete)                                 |
| Reviews               | Hotel Elegance 256 (avg 3.93), Urban Move 2                                         |
| Snapshot run          | `completed / terminal`, main 6 pages, confirmation 6 pages, no failure              |
| Review-event cursor   | `consumed=256 terminal=256` at source epoch 0                                       |
| Outbox                | 789 events, 0 unpublished                                                           |
| Denials in web log    | none                                                                                |
| Worker job failures   | none                                                                                |

## 1. A freshly imported property had no capabilities

`property_capability` was empty for the new property while `Urban Move` held 18
rows, so every non-core capability denied: the Performance card rendered
"Performance is not available for this property", and `ai.getPropertyTrend`,
`portal.listPortals` and `team.listTeams` returned
`AuthError(property_not_allowlisted)` → 403. `checkScopedCapability`
(`shared/auth/beta-capabilities.ts:390`) requires a per-property allowlist row
for anything outside `CORE_CAPABILITIES`.

**Fixed in code, not by hand.** The Google import now provisions a created
property with its organization's capability set:
`provisionPropertyCapabilities` is injected into
`createGoogleImportV2Processor`, implemented by
`provisionPropertyCapabilitiesFromOrganization`, which inserts
`SELECT … FROM organization_capability … ON CONFLICT DO NOTHING` and bumps
`policy_version` in the same statement — the cross-process invalidation
contract. Provisioning failure logs and continues rather than failing an import.
Relink does not re-grant.

For properties that predate the wiring:

```bash
pnpm ops:property-capabilities list --all --operator <id> --org <id>
pnpm ops:property-capabilities sync --all --operator <id> --org <id> --apply
```

Dry-run by default. It binds `getDb()` directly rather than the composition root
— the container demands `REDIS_URL`, and Redis is only reachable inside the
deployment, which would make the command unrunnable from an operator
workstation.

## 2. Review sync rejected every page Google sent

`sync-property-reviews` failed three times with `malformed_page` and
quarantined. Instrumenting the parse (key names and zod issue paths only) showed
the real page:

```
keys: ["averageRating","nextPageToken","reviews","totalReviewCount"]
issues: reviews.0:unrecognized:reviewId|updateTime|reviewReplyUrl   (×12)
```

`gbpReviewItemSchema` and `gbpReviewsPageSchema` were `.strict()`, so the
provider's `reviewId`, `updateTime`, `reviewReplyUrl` and top-level
`averageRating` turned a valid page into `malformed_response`. The sibling Google
adapters (`gbp-api`, `google-business-information`) already tolerate unknown
keys; the review adapter was the outlier. Unknown keys are now dropped and every
consumed field stays validated. 256 reviews synced.

## 3. AI review analysis rejected every event

`ai.analyze-review-event` failed with `ZodError` on every `review.created`: its
payload schema was `.strict()` and omitted the envelope fields every emitted
event carries — `correlationId`, `occurredAt`, and `platform` (the latter two in
the canonical registry at `shared/events/schema-registrations.ts:24`).
Insert-time allowlisting (BQR-2.5) is the guard that matters; a consumer
re-asserting "no other keys" only converts envelope additions into outages.

## 4. Consumer failures were undiagnosable

`Consumer handler failed` logged `err` alone, which serializes to
`{ "name": … }` — a schema rejection, a sequence gap and a provider retry looked
identical. The dispatcher now also logs `failureReason` (error name + first
message line, capped at 200 chars, mirroring the quarantine envelope). That line
is what exposed defects 5 and 6 within minutes.

## 5. The AI plane could not serve a property at source epoch 0

`properties.source_epoch` is a **0-based** source generation: 0 on creation,
advancing on a timezone change (`update-property.ts:198`), a soft delete, or a
region move. `reviews`, `review_ai_analysis_heads` and the registered
`review.created` payload all accept 0. The AI plane demanded `>= 1` in eleven
CHECK constraints (`ai_review_analyses`, `ai_review_event_cursors`,
`ai_property_daily_aggregates`, `ai_property_aggregate_heads`,
`ai_property_aggregate_contributions`, `ai_property_processing_profiles`,
`ai_property_trend_schedules`, `merchant_ai_enablement`,
`merchant_ai_consent_evidence`, `ai_operations`, `replies`) plus
`consume_ai_review_event_v1` and `apply_merchant_ai_transition_v1`, and in
`property-processing-profile.adapter.ts`.

Effect: review analysis, aggregates, trends, reply provenance and the AI opt-in
were unreachable for any property whose epoch had never been bumped by an
unrelated edit. `Urban Move` only ever qualified because someone changed its
timezone.

**Decision: the AI plane adopts the domain's 0-based numbering** —
`drizzle/0060_ai-plane-source-epoch-zero.sql` rewrites all eleven constraints and
both function guards, with the matching change in the Drizzle model so the
semantic parity gate holds. No data migration: every stored row already satisfied
`>= 0` and no key or column type moves. The alternative — having the import stamp
epoch 1 — would have required rewriting the `source_epoch` of already-stored
reviews and analysis heads, which are keyed by it.

Two earlier migrations are part of the record: 0058 loosened only the
`consume_ai_review_event_v1` guard, which relocated the failure to
`ai_review_event_cursors_sequences_valid`; 0059 restored it. 0060 supersedes
both.

**The database was necessary but not sufficient.** Enabling AI in the UI still
failed with `Invalid Merchant AI source_epoch row`, because nine
application-layer sites carried the same off-by-one. Fixed in the same pass:

| Site                                          | Was                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------- |
| `merchant-ai-authorization.repository.ts:172` | snapshot read, min 1                                                  |
| `:390`                                        | source discovery read, min 1 — **this is what the owner's click hit** |
| `:395`                                        | discovered authorized epoch, min 1                                    |
| `:447`                                        | locked property read, min 1                                           |
| `property-processing-profile.adapter.ts:78`   | `readForAi` drift guard `< 1`                                         |
| `property-processing-profile.adapter.ts:175`  | `refreshForAi` guard `< 1`                                            |
| `identity/domain/events.ts:193`               | assertion `>= 1`                                                      |
| `shared/auth/execution-policy.ts:133`         | consent fence `>= 1`                                                  |
| `shared/jobs/delayed-execution-gate.ts:194`   | fence parse `< 1`                                                     |
| `shared/events/schema-registrations.ts:415`   | `positive()` on the event payload                                     |

Capability epochs, `state_version` and `routing_policy_version` stay 1-based —
only the source epoch moved.

Coverage now exists at the level that would have caught it:
`merchant-ai-authorization.repository.integration.test.ts` runs the whole
`mutate` transaction at epoch 0 against a real database — source discovery, the
locked property read, `apply_merchant_ai_transition_v1`, the enablement row, its
consent evidence, the snapshot read-back and idempotent replay. Restoring any of
the old minimums fails it with the operator-visible message.

Verified: `pnpm test:integration` parity gate green against a database migrated
from empty; a new integration test consumes a review event at source epoch 0; and
on the live database `apply_merchant_ai_transition_v1` with
`authorized_source_epoch = 0` returns accepted inside a rolled-back transaction.

## 6. A completed scan ended as `cursor_failure` and never transitioned

Two defects, one symptom. The cursor instrumentation named the first:

```
{ operation: 'publish_next', code: 'binding_mismatch', phase: 'main',
  pageIndex: 6, parentCursorRefPresent: false, nextPageIndex: 7 }
```

A null cursor anywhere but page 0 means the previous page was final. The
continuation called the provider anyway — **without a page token**, silently
re-reading page 1 — then tried to publish a cursor for a page that does not
exist, which the store refuses. `runListPage` now finishes the phase instead
(`finishPhase`, shared with the final-page path; `finishMainScan` is idempotent
and reports `confirming` when another worker got there first).

That exposed the second: `finishMainScan` had never once executed against
Postgres, and two of its statements put a bound timestamp into interval
arithmetic without a cast. Postgres resolves `$n - interval` as
`interval - interval`, so the parameter became an interval:

```
operator does not exist: timestamp with time zone <= interval
```

Both are now `${run.startedAt}::timestamptz`. A new integration test,
`review-provider-snapshot.repository.integration.test.ts`, executes the real
statements — verified to fail when the cast is removed.

The run now reaches `completed / terminal`: main 6 pages / 256 reviews,
confirmation 6 pages, no failure code.

Note on `review_sync_state`: it has **no writers** anywhere in the codebase —
only `health-metrics.ts` reads it. Its emptiness is not a defect; ongoing sync is
driven by Google Pub/Sub notifications into `handle-gbp-notification` →
`addSyncJob`.

## 7. Reply drafting 500'd because the language runtime was bundled

The opt-in went through: `Hotel Elegance` now holds an enabled
`merchant_ai_enablement` row at `authorized_source_epoch = 0` with all three
capabilities and `analysis_start_sequence = 256`. The first suggestion request
then failed with "A suggestion is unavailable right now." — the fallback branch
of `unavailableMessage()`, i.e. neither `not_authorized` nor
`language_not_supported` nor `source_changed`, so not a policy denial. The web
log named it:

```
TypeError: runtimeModule is not a function
    at .output/server/_libs/cld3-asm+[...].mjs:80:21
    at loadModule (...:1836:99)
    at async createCld3ReplyLanguageDetector (composition-*.mjs:60955)
    at async Object.resolveReplyLanguage (composition-*.mjs:68230)
    at async Object.generateReplySuggestion (composition-*.mjs:64618)
```

`cld3-asm` ships emscripten glue whose loader expects to be called as a CJS
factory. The Nitro `rollupConfig.external` list held only `/^@sentry\//`, so the
package was bundled and its loader was rewritten. Reply drafting cannot mint a
suggestion until the local verifier establishes one concrete source language, so
this failed every suggestion, for every property and language.

Fix: `external: [/^@sentry\//, /^cld3-asm(\/|$)/]` in `vite.config.ts`. Runtime
resolution is also the attested path —
`ai-reply-language-verifier-v1.manifest.json` pins
`node_modules/cld3-asm/dist/cjs/lib/node/cld3.js` by sha256, and
`scripts/verify-ai-gateway-runtime-assets.ts` already hashes that on-disk file.
Bundling had quietly diverged from what the manifest attests.

Why no test caught it: the source imports fine — only the built output can be
wrong — and `ai-reply-language-verifier.test.ts` injects a fake detector
(`{ detect: () => ... }`), so nothing in any suite ever called `loadModule`.
(Its 37 cases are additionally `describe.runIf`-gated on `icu === '78.2'`, which
CI satisfies at the pinned node 22.23.2 but a newer local node does not.)

Closed by `scripts/check-runtime-language-verifier.mjs`
(`pnpm check:language-verifier`, wired into ci.yml after the web build,
registered in the BQC-2.1 entry-point catalogue). Following
`check-security-headers.mjs`: static checks cannot prove a runtime module loads,
so the gate asserts against `.output/server` that the package stayed external, is
still imported by bare specifier, and resolves + initializes its WASM + detects
English from a module inside the artifact directory, with the loader matching the
attested digest. Rebuilding without the external fails it on both structural
counts.

## 8. The AI plane was reading Google's translation, not the guest's words

With the runtime loading, reply drafting returned `language_not_supported`. That
turned out to be honest, and it exposed a data defect underneath.

Google Business Profile puts BOTH its machine translation and the original in a
single `reviews[].comment`:

```
(Translated by Google) Ok

(Original)
Ок
```

`google-review-api.adapter.ts:262` stored that verbatim (`text: raw.comment ?? null`),
and nothing in the codebase parsed it. Since `reviews.language_code` is NULL on all
256 rows — Google sends no language field — local cld3 detection is the _only_
language signal, and it was reading Google's English.

Measured over the property's 93 texted reviews, comparing the stored blob against
the unwrapped original:

|                           | stored blob | original text |
| ------------------------- | ----------- | ------------- |
| reliable English          | 23          | 13            |
| Bulgarian (off-catalogue) | 6           | 40            |
| repliable ru / tr / fr    | 0           | 8             |

Two failures, in opposite directions:

- **8 Bulgarian reviews scored as reliable English.** A suggestion there would
  have drafted an English reply to a Bulgarian guest — exactly what the language
  verifier exists to prevent, defeated by its input.
- **8 genuinely repliable `ru`/`tr`/`fr` reviews were rejected**, because the
  two-language blob reads as unreliable.

The wrapper also inflates the evidence bar it is measured against:
`(Translated by Google)` is 19 English letters, so a 2-letter Bulgarian `Ок`
clears the 24-letter `MIN_REPLY_LANGUAGE_LETTERS_V1` on boilerplate alone.

Fixed at the provider edge. `parseGoogleReviewComment` (`src/shared/google-review-comment.ts`)
splits the envelope; `reviews.text` now holds the guest's original — what the AI
plane reads — and the new `reviews.translated_text` holds Google's translation,
threaded through `GoogleReview`/`Review` and both mapper directions. The inbox
renders the original with the translation beneath it under a `Translated by Google`
caption, inside the same eligibility gate, so an expired review still shows
neither (proven by a story whose fixture _has_ a translation and still renders none).

Stored rows are repaired by `pnpm ops:reparse-review-translations` (report/repair,
dry-run by default, idempotent). It recomputes `content_hash` AND the
`ai_source_digest`/`ai_source_byte_length` pair using the same production functions
the sync path calls, because `ai_source_digest` is the revision gate: recomputing
only the text would have made 76 rows look content-changed, emitted 76
`reviewUpdated` events, and pulled reviews created before the opt-in into analysis —
quietly defeating the `analysis_start_sequence = 256` watermark. It issues a
targeted column UPDATE rather than going through the repository, so
`source_revision`, `analysis_sequence` and the review lifecycle are untouched.

## 9. Bulgarian support, and the consent notice it forced

40 of the property's 93 texted reviews are Bulgarian, the property is in Sofia, and
`bg-Cyrl` was not among the 23 reply template groups. Added as the 24th (appended
last, so existing indices stay stable), with 12 reviewed Bulgarian templates
(4 template ids x 3 tones). Script consistency needed no new artifact: the check is
keyed on the script subtag, and `Cyrl` already existed for `uk`/`ru`.

The catalogue is not a free-standing list, and widening it moved a chain:

```
REVIEW_LANGUAGE_GROUPS
  -> consent notice prose (enumerates the groups sent for provider work)
     -> MERCHANT_AI_NOTICE_DIGEST
        -> merchant_ai_enablement / merchant_ai_consent_evidence CHECKs (live)
  -> language catalogue attestation
     -> AI operation profile digests (review-analysis-v1, reply-suggestion-v1)
        -> ai_operation_profiles seed, byte-compared at request time
  -> reply template catalogue digest
     -> replies_ai_provenance_valid CHECK
```

**The consent notice was the load-bearing one.** Its section 76 enumerates the
supported analysis groups, so adding Bulgarian widens what the merchant is asked to
agree to. No test derives that prose from the catalogue, so it would have gone
silently stale — the worst outcome for a consent artifact. Re-versioned to
`merchant-ai-notice-2026-08-19.v1` (digest `f0d809ba…`) with the owner's explicit
approval, and both CHECKs widened from a single pinned value to a **known-version
set**, each version bound to its own digest. Consent evidence is append-only, so
historical consent stays valid at the version it was granted under rather than being
rewritten; Bulgarian only becomes reachable once the owner re-consents under the new
notice.

Three test files held self-consistent OLD version + OLD digest pairs, so converting
only the version would have introduced a fresh CHECK violation. All 20 literals
across 11 files are now bound to `MERCHANT_AI_NOTICE_VERSION` /
`MERCHANT_AI_NOTICE_DIGEST` so the next re-version cannot drift them.

Incidental find while regenerating: `replies_ai_provenance_valid` rendered
`tag ~~ group || '-%'` from the drizzle model. `~~` and `||` share precedence and
associate left, so that parses as `(tag ~~ group) || '-%'` — boolean concatenated
with text. The live constraint carries explicit parentheses, so the model had been
mis-rendering it all along; it only surfaced when this change forced a DROP/ADD.
Fixed with explicit parens in `review.schema.ts`.

## 10. The consent form could not submit a re-consent

After the notice re-version the owner could not simply re-submit the AI settings
form: `canSave` (`merchant-ai-settings-page.tsx`) required `selectionChanged`,
which compares **capability membership only**. With a re-versioned notice and an
unchanged capability set the button stayed disabled, and the only way through was
to drop a capability and re-add it.

The server disagreed all along: `executionContractChanged`
(`merchant-ai-authorization.repository.ts:226`) counts a notice version/digest
change as a real change, which is why the two-step workaround succeeded at all.

The workaround was not free. It briefly **revoked** a live capability, wrote an
extra consent evidence row, and bumped that capability's epoch twice — visible in
the trail as `v1 enable caps=3 / v2 change caps=2 / v3 change caps=3`, with
`property_trends` landing on epoch 3 while the other two sit at 2.

Fixed by mirroring the server's rule in the client:

```ts
const contractChanged =
  snapshot !== null &&
  (snapshot.noticeVersion !== notice.version || snapshot.noticeDigest !== notice.digest)
canSave={canSubmit && (selectionChanged || contractChanged) && …}
```

Defended by the `ReconsentAfterNoticeReversion` story, whose fixture is exactly
that state — identical capabilities, stale notice. Restoring the old gate fails it.

## 11. Reply drafting rejected epoch 0 in the operation identity

With consent current, the next suggestion 500'd with
`Invalid durable AI operation: reply identity is invalid`.

`createAiOperationIdentity` in `src/contexts/ai/domain/rules.ts` asserted
`isPositiveSafeInteger(value.sourceEpoch)` in **four** places — the shared binding
validator plus the analysis, reply and trend branches. Defect #5 swept
`readInteger` minimums, zod `positive()` and the fence checks, but not this
predicate, so a property at the domain default epoch of 0 had its reply operation
rejected as corrupt. A fifth site, the restore-reset path at
`merchant-ai-authorization.repository.ts:756`, demanded `source_epoch >= 1` as a
liveness proxy; liveness there is `deleted_at IS NULL`, not a non-zero epoch.

Why the earlier sweep missed it: every existing fixture used a non-zero epoch
(`sourceEpoch: 2`), so no test exercised the boundary, and four tests actively
encoded the wrong rule by mutating `sourceEpoch = 0` and asserting rejection.
Those now use `-1`, and new cases assert that all three commands accept 0, reject
negatives, and still require the genuinely 1-based `sourceRevision` /
`analysisSequence` neighbours to be positive.

## 12. A rotated digest is also pinned in the deployment environment

Deploying the rotated catalogue crashed `ai-egress-gateway` and
`ai-execution-admission` with no runtime logs. Reproduced locally against the live
variables: `AI_RUNTIME_CAPABILITY_CATALOGUE_DIGEST` is asserted at boot against the
compiled `AI_RUNTIME_CAPABILITIES_V1_DIGEST`, and both services still held
`902c965d…` while the build expected `191e8eef…`.

No gate can catch this statically — the value lives in Railway, not the repo — so
the boot error is the only signal, and it named neither the variable's value nor
the expected one. Both services' contract-variable checks now route through
`assertContractVariable`, which reports:

```
AI gateway AI_RUNTIME_CAPABILITY_CATALOGUE_DIGEST is stale: environment has
902c965d…, this build expects 191e8eef…. Rotate it on ai-egress-gateway and
ai-execution-admission, then redeploy.
```

A second-order trap sat behind it: the gateway's startup readiness probes the
admission service over mTLS, so while admission was down with the same stale
digest the gateway crashed with `AI gateway startup readiness failed` — a
misleading symptom. Rotate both variables, deploy admission first, then the
gateway.

**Any future digest rotation must include a deployment-variable sweep.** The values
to check are `AI_RUNTIME_CAPABILITY_CATALOGUE_DIGEST`,
`AI_PROVIDER_DEPLOYMENT_PROFILE_DIGEST`, `AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION`
and `AI_GATEWAY_BUILD_ATTESTATION_DIGEST` on both AI services.

Unrelated observation, not caused by this work: `pnpm ops:ai-canary issue` returns
`not eligible` for a release SHA with no existing head. Every digest embedded in
`issue_ai_canary_authorization_v1` was verified to match the live rows
(`191e8eef`, `580a1322`, `c362776c`), so the repin is not the cause. Worth a
separate look — canaries currently only pass for a SHA that already has a head.

## 13. The same epoch-0 rule was wrong in a third layer

With consent current and the operation identity fixed, the next suggestion 500'd
again:

```
ZodError: [{ "code": "too_small", "minimum": 0, "inclusive": false,
             "path": ["binding","sourceEpoch"],
             "message": "Too small: expected number to be >0" }]
    at parseAiGatewayRouteRequest
```

`aiExecutionBindingSchema` (`ai-internal-transport-contract.ts:572`) declared
`sourceEpoch: positive`. Two mirrored reply-provenance schemas
(`src/shared/ai-reply-provenance.ts:30` and
`services/ai-egress-gateway/provenance.ts:27`) had the same defect and would have
failed at adoption even if generation had succeeded.

**This was the third layer of one bug, found by the owner clicking three times.**
Defect #5 fixed the database and repository reads, #11 fixed the domain identity
validator, and this fixed the wire schemas. Each earlier sweep was scoped to the
expression form that had just failed — `readInteger` minimums, then
`isPositiveSafeInteger` — instead of to the _concept_. Every fixture in every one
of these files used a non-zero epoch, so nothing failed until a real epoch-0
property reached it.

The sweep is now exhaustive rather than incremental: ten field spellings that carry
a source epoch (`sourceEpoch`, `source_epoch`, `authorizedSourceEpoch`,
`originSourceEpoch`, …) crossed with seven ways this codebase expresses "must be

> = 1" (`: positive` alias, `.positive()`, `.min(1)`, `isPositiveSafeInteger`,
> explicit `>= 1` / `> 0` / `< 1`, `readInteger(…, 1)`, `readSafeBigint(…, 1)`)
> across `src`, `services` and `scripts`. It returns clean. The genuinely 1-based
> neighbours were audited in the same pass and keep their strict assertions:
> `propertyProfileVersion` 4, `routingPolicyVersion` 2, `sourceRevision` 6,
> `reviewAnalysisEpoch` 4, `replyDraftingEpoch` 4, `propertyTrendsEpoch` 2.

Coverage now exists at the wire boundary: `ai-gateway-transport-contract.test.ts`
asserts both the analysis and reply route requests parse with
`binding.sourceEpoch = 0`, that a negative epoch is still rejected, and that
`propertyProfileVersion` / `routingPolicyVersion` still reject 0. Reverting the
binding field to `positive` fails it.

## 14. The admission authority denied every property

`admit_ai_property_v1` (from 0049) carried two independent defects on the same
branch, either of which denies every AI operation with `authorization_changed`,
surfaced to the caller as `capability_epoch_changed`:

```sql
SELECT 1 FROM organization_capability
 WHERE capability = capability_name        -- 'reply_drafting'
OR NOT EXISTS (SELECT 1 FROM property_policy
                WHERE property_id = … AND suspended_at IS NULL)
```

1. **Wrong vocabulary.** `organization_capability` stores PURPOSES
   (`ai.analyze`, `ai.generate_reply`, `ai.detect_trends`) — see
   `CAPABILITY_BY_PURPOSE` at `merchant-ai-authorization.repository.ts:49`. The
   guard compared it against the capability name, so the row could never be found.
   `operation_profile_row.purpose` was already in scope.
2. **Inverted polarity.** `property_policy` rows are written only by
   `setPropertyPolicy` — the ops suspend/restore command. A property that has never
   been suspended has no row, so requiring one to exist denied it. Of the two beta
   properties only `Urban Move` had a row, and only because it was once restored.

`drizzle/0063_ai-admission-authority-repair.sql` replaces the function with those
two lines changed and nothing else; the registry entry moved from 0049 to 0063.

**This is why no `ai_review_analyses` row has ever existed here.** The synthetic
canary carries no property and skips both guards, which is why it could pass while
every real analysis, reply and trend was denied at admission.

The integration test encoded both defects in its fixture — capability names in the
wrong namespace, plus a `property_policy` row production never has. Made
production-faithful; with the old guard those tests now fail with
`property admission denied: authorization_changed`, the exact code the owner's click
produced.

## 15. The egress gateway was unobservable

Past admission, the reply failed as `operation_ambiguous` with no diagnostic
anywhere. The gateway had emitted **not one line** in its entire life — only
Railway's own `Starting Container`.

`no_dispatch` had five producers, all silent:

| Site                                   | Cause                                                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `service.ts:384`                       | grant TTL below provider deadline + 5s, or caller deadline aborted                                        |
| `openai-connector.ts` attestation gate | any of **twelve** checks folded into one boolean                                                          |
| same, `catch`                          | attestation itself threw                                                                                  |
| same, post-dispatch `catch`            | dispatch threw before any byte left the process                                                           |
| `dispositions.ts:95`                   | `enforceOutboundFetchDisposition` REWRITES a mismatched outcome to `no_dispatch`, discarding the original |

That last one is the worst: a genuine provider or output failure that never reached
the network is reported as a bare `no_dispatch`, erasing the real reason.

All five now emit a bounded `gateway_no_dispatch` / `gateway_disposition_rewritten`
line naming the stage, the failing check, and the numbers behind it. Nonce
consumption was deliberately left LAST so a diagnostic can never burn a nonce that
would otherwise have dispatched. Identifiers, booleans and public contract digests
only — never key material, never provider bytes.

A `gateway_listening` line now marks each boot with the release SHA and the
contract digests being enforced, which also proved stderr _is_ captured — the
silence was real, not a log-transport problem.

Two process traps found while chasing this, both of which wasted a diagnostic cycle:

- `railway.ai-egress-gateway.json` sets `drainingSeconds: 130`, so a click within
  ~2 minutes of a deploy can still be served by the **old** replica. Wait out the
  drain before trusting a negative result.
- `railway connect` ignores `-i` and picks the wrong SSH key. Query production
  through the web container's own `pg` client instead — no tunnel, no key ambiguity.

Unresolved observation: the gateway boots with `RELEASE_SHA=89bec3f1…` while web
reports `82ffcbed…`. The canary head for `89bec3f1…` is `passed`, which is why the
canary succeeded at 09:00. Whether the two services are meant to share a release
identity is worth settling — `ops:ai-canary issue` also refuses a SHA with no
existing head, which blocks self-verification of the egress path.

## 16. The reply grant expiries were swapped

`admit_ai_property_v1` returns two expiries for the reply route. It assigned the
far-future review `content_expires_at` (2026-09-18) as the request-scoped TOKEN
expiry, and `LEAST(content_expiry, caller_deadline)` — about 70 seconds out — as the
DRAFT expiry.

Two independent consumers require `token <= draft`, because a request-scoped token
must not outlive the draft it authorises: `grantMatchesInvocation` in the gateway,
and `validateGrantFields` in the shared grant contract, which rejects the inverse as
_"grant fields are inconsistent"_. With a content expiry weeks out the ordering could
never hold, so the gateway answered `operation_ambiguous` and the request's `finally`
wrote a `no_dispatch` settlement. The connector was never entered, which is why the
five diagnostics added for #15 stayed silent.

Found from data rather than another attempt: the permit was admitted at
`17:10:40.691`, consumed at `.820` and settled at `.840`. A 20 ms consume-to-settle
gap with zero connector output can only mean the failure sat between `authorize`
returning and the connector being invoked, and `grantMatchesInvocation` is one of two
things there. `content_expires_at` was checked first and was valid on all 256 rows,
which left the ordering as the only candidate.

Fixed in `drizzle/0064`: token bounded by the caller deadline, draft by content
expiry. Live function confirmed `token=LEAST (correct)`.

**Why nothing caught it:** no integration test had ever admitted the reply route.
Every descriptor in the admission test file used `route: 'review-analysis'`, and for
that route both reply expiry columns are NULL, so the swap was structurally
invisible. An attempt to bolt an assertion onto the analysis test was rejected by
TypeScript — `'"review-analysis"' and '"reply-suggestion"' have no overlap` — proving
the guard could never have run. A real reply-route admission test now exists and
fails when the swap is restored.

## 17. A global reasoning effort truncated every tenant route

The reply took 36–45 s and, before #16 was fixed, frequently returned nothing. The
cause was one line: `reasoning: { effort: 'xhigh' }`, hardcoded as a type literal in
`buildClosedOpenAiRequest` and applied uniformly to all four routes.

Every route here is constrained-vocabulary selection — enums, or IDs from a supplied
candidate list. Measured against the live deployment by replaying the exact request:

| route            | xhigh                                     | low               |
| ---------------- | ----------------------------------------- | ----------------- |
| review-analysis  | 26.2 s, 4096 tokens, **truncated, empty** | 2.2 s, 204 tokens |
| property-trend   | 55.5 s, 8192 tokens, **truncated, empty** | 2.0 s, 203 tokens |
| reply-suggestion | 42.5 s, 6144 tokens, **truncated, empty** | 1.2 s, 80 tokens  |
| synthetic-canary | 1.4 s, 110 tokens                         | 1.0 s, 39 tokens  |

At `xhigh` the model spent its ENTIRE output budget on reasoning and returned an
empty body: `incomplete_details.reason = 'max_output_tokens'`, so `safeParse` failed
and the route reported a bare `output_invalid` after a fully-billed call. The three
replies that did succeed carried 3492, 3934 and 5672 reasoning tokens against a 6144
ceiling — they were riding the same cliff and merely got lucky.

**This is why the canary was green while nothing worked.** The canary returns a fixed
marker, the only task trivial enough to survive `xhigh`. `ai_review_analyses` was 0
all session partly because analysis truncates 100% of the time at `xhigh`.

Lower effort was also _more accurate_: for a 3-star review complaining about
accessibility, `low` selected `acknowledge_concern` while `high` selected
`appreciation_neutral`.

Fixed in `drizzle/0066` plus the code: `reasoningEffort` is now a per-route governed
profile column, exactly like `max_output_tokens`, set to `low` on all four routes,
with ceilings resized to measured usage (4096/6144/8192/2048 → 1024/1024/2048/512) so
a future runaway fails in ~4 s instead of ~55 s. `xhigh` and `max` are excluded from
both the TypeScript ladder and a new SQL CHECK; `minimal` is excluded because the
pinned model snapshot rejects it with 400.

The canary deliberately carries the same effort as the tenant routes now: a gate that
does not share production's provider configuration cannot detect a
provider-configuration fault.

**Observability:** truncation was entirely unhandled — `incomplete_details` appeared
nowhere in the gateway. A content-free `openai_output_truncated` diagnostic (a
provider enum and three integers, safe on tenant routes unlike `usageRejected`) now
names it.

Measured segments confirm nothing else is slow: `create_to_admit` 0.000 s,
`admit_to_consume` 0.111–0.161 s, `consume_to_settle` 36–45 s. The fixed overhead is
~120 ms; the provider call was the entire latency.

Open follow-up, not yet changed: the reply developer prompt says _"Select exactly one
**listed** application template ID"_ but no list is supplied — the four IDs exist only
as opaque enum values in the JSON schema, with no rubric for choosing between them.
That underspecification is what gives the model something to deliberate about. It
answers correctly at `low`, so this is a quality and determinism concern rather than a
fault, and it needs its own prompt version and digest ceremony.

## Remaining: end-to-end AI verification

**Consent is current.** `notice_version` is read off the enablement row
(`merchant-ai-authorization.repository.ts:176`) into the request binding, and
`ai-gateway-transport-contract.ts:247` compares it against the
`ai_runtime_capability_profiles` entry that migration 0062 moved to
`merchant-ai-notice-2026-08-19.v1`. Until the ceremony was repeated every operation
resolved `route binding is cross-wired`; `assert_ai_capability_set_executable_v1`
refused the old pair directly, verified on the live database.

The owner re-consented on 2026-08-19. Hotel Elegance now holds
`notice=…-08-19.v1  state=enabled  state_version=3  caps=3  source_epoch=0
analysis_start=256`, all three runtime profiles compare `MATCH`, and the evidence
trail preserves the original v1 grant alongside the two v2 rows. That is the
known-version set working as designed: append-only consent stays valid at the
version it was granted under, while execution demands the current one.

Corpus effect of #8 + #9, measured on the repaired production rows (93 texted
reviews of 256; the other 163 are rating-only with no text):

|                   | before                             | after          |
| ----------------- | ---------------------------------- | -------------- |
| repliable         | 25 (10 of them the wrong language) | **62**         |
| bg                | 0                                  | 39             |
| en                | 23                                 | 13             |
| ru / tr / fr / de | 1                                  | 10             |
| off-catalogue     | 7                                  | 4 (`ro`, `fi`) |

Still unobserved end to end: a real review event minting a permit → admission →
gateway → OpenAI → an `ai_review_analyses` row → daily aggregates → a trend
schedule. `ai_property_trend_schedules` is empty and no analysis row has ever
existed here; only the synthetic canary has crossed the gateway.

After opting in, note the blueprint's own scope: historical backfill stays
denied. `analysisStartSequence` is set from the current analysis head (256 for
Hotel Elegance), so analysis applies to reviews created or updated from that
point on, not to the 256 already stored.
