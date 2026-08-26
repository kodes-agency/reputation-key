# Engineering implementation facts for legal and release review

**Status:** Engineering fact map — not a privacy notice, contract, legal opinion,
or approval

**Captured:** 2026-08-26

**Owner:** Product and Engineering

**Release use:** Counsel and provider-review input only; do not publish this file
as customer-facing legal text

This document reconciles the current product decisions and repository behavior
with the older drafts in this directory. It deliberately separates four things
that must not be conflated:

1. behavior implemented in the repository;
2. capability policy, which can still keep implemented behavior unavailable;
3. target infrastructure, which is not proof of live deployment; and
4. legal/provider acceptance, which Engineering cannot grant.

The executable capability map, context contracts, retention registry, and
release ledger take precedence over an older draft when they disagree. A live
platform or provider claim still requires dated external evidence.

## 1. Current product posture

`src/shared/governance/capability-fate.ts` is the exhaustive product authority.
Its categories mean:

| Posture                       | Current scope                                                                                                                                                                                                                                              | Legal/release consequence                                                                                                                                                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Core                          | Invite-only identity, authorized Property creation and Google connection, human-confirmed reply publication, in-app notifications, Review, Inbox, Dashboard, Staff participation/attribution, Integration, Recent Activity, and internal Metric processing | Available by default, subject to global stops and tenant suspension. Internal analytics/metrics are a core service function; the product does not offer a capability opt-out. The notice and lawful-basis/rights analysis still need counsel approval. |
| Controlled beta               | Google import/performance reads, email delivery, Portal management/public gateway/Guest rating/private feedback/Contact Request, Goals, Review Analysis, Reply Drafting, and Property Trends                                                               | Presence in code is not activation. Persisted Organization/Property policy and each package's readiness evidence must agree.                                                                                                                           |
| Excluded from beta            | Public registration, secondary Organization self-service, ordinary destructive Property erasure, Guest media, and Team                                                                                                                                     | No tenant setting can enable these in beta. Portal Groups are the accepted grouping model; they are not Teams.                                                                                                                                         |
| Temporarily unavailable       | Portal image upload                                                                                                                                                                                                                                        | Tenant policy alone cannot enable it. Its named readiness package must close first.                                                                                                                                                                    |
| Retained only for contraction | Legacy Badge and Leaderboard behavior                                                                                                                                                                                                                      | These are not the accepted recognition model and must not be reactivated.                                                                                                                                                                              |
| No activation path            | Automatic reply publication, AI cross-Property summaries, and review-solicitation gamification                                                                                                                                                             | These behaviors are denied by product policy. Human confirmation and Property-local boundaries remain mandatory.                                                                                                                                       |

Staff participation and attribution being core does **not** activate Staff User
login. Goals use scans, rating count, and rating average for a Property, Portal
Group, or individual Portal; they are not competitive rankings.

## 2. Portal and Guest journey

The Portal is primarily a Property-owned review gateway and secondarily an
optional link tree. The published guest journey is:

1. show the published Portal experience;
2. collect a private 1–5 star rating;
3. show the same Property-owned Google Review action first, with the same copy,
   order, timing, and prominence for all five ratings;
4. for a rating at or below the Portal's inclusive threshold (default `3`),
   also allow optional private feedback; and
5. show optional secondary links after those review actions.

The Google destination is derived from the verified Property connection and is
captured in an immutable publication snapshot. Managers do not type a Google
review URL into a Portal. If that destination later becomes unavailable, the
private rating/feedback journey remains usable and the browser receives no
stale destination URI.

Multiple eligible managers may be assigned responsibility for one Portal.
Private-feedback workflow notifications go to those assigned managers. The
creator is assigned initially when eligible, but creation is provenance rather
than permanent or exclusive notification ownership. Account administrators are
used only for the explicit unowned recovery state; notifications do not fan out
to every Property Manager.

### Guest data map

| Data class                 | Current purpose and access                                                                                                                                                                                          | Current lifecycle authority                                                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Visit/scan fact            | Portal, Property, source (`qr`, `nfc`, or `direct`), and time support always-on operational metrics.                                                                                                                | Session pseudonym is redacted after 24 hours and the rotating abuse pseudonym after 7 days. The base visit-fact horizon is not defined by the static registry and needs an explicit product/counsel decision.                              |
| Private rating             | A 1–5 Portal rating supports manager metrics and the guest journey. It is distinct from a public Google Review rating.                                                                                              | The new canonical content-free response fact/tombstone expires after 24 calendar months. Legacy rating rows retain compatibility behavior; their final contraction/lifecycle must be resolved before the notice states one universal rule. |
| Experience evidence        | Exact Portal publication version/digest, threshold, locale, language-pack version, and capture time explain which experience produced a rating. The guest browser does not receive internal identifiers or digests. | Stored with the response evidence; final legal characterization follows the response lifecycle and contraction decision.                                                                                                                   |
| Private feedback text      | Optional text, maximum 2,000 characters, available only after an eligible rating and routed into manager workflow.                                                                                                  | Stored separately for at most 90 days. The same signed session may withdraw it for 24 hours; reads deny expired text even before the bounded sweep removes it.                                                                             |
| Contact Request            | The capability is separately classified as controlled beta.                                                                                                                                                         | Current public submission paths hard-disable contact collection. Purpose, consent copy, encryption, access, retention, delivery channel, and withdrawal behavior must be accepted before activation. Phone collection remains excluded.    |
| Guest session binding      | Supports duplicate prevention, correction/withdrawal, and first-action semantics without a Guest account.                                                                                                           | Maximum 24 hours, with an absolute deadline rather than a rolling extension.                                                                                                                                                               |
| Network-abuse pseudonym    | A daily-salted hash supports rate limiting and abuse handling; raw Guest IP is not stored as the Guest interaction value. It is not an identity or staff-performance signal.                                        | Redacted after 7 days.                                                                                                                                                                                                                     |
| Destination-action receipt | Records the first qualified Google or secondary-link selection for core analytics. A navigation-only redirect does not increment it.                                                                                | Session-bound deduplication receipt expires within 24 hours; the remaining content-free action fact needs the same explicit base-fact horizon decision as other Guest metrics.                                                             |
| Guest media                | Compatibility rows may exist for audit/purge handling.                                                                                                                                                              | No public issuance or confirmation route exists in the first beta cohort.                                                                                                                                                                  |

Guests may withdraw the whole response for 24 hours after the initial rating.
That removes the effective rating and any still-effective feedback while
retaining only the bounded lineage/tombstone needed for correctness. Rating
integrity decisions do not use rating value, feedback text, or Guest identity.

## 3. AI and Google-sourced content

Review Analysis, Reply Drafting, and Property Trends are three independent
Property-level capabilities. All are unavailable unless authorization, current
Property access, accepted notice version, provider policy, runtime catalogue,
and cell-local readiness agree. Property Trends also depend on Review Analysis.

AI inputs are limited to currently eligible Google Review content. Private
Portal ratings, feedback, Contact Requests, Inbox notes, manager text, and Guest
media are outside the AI boundary. Provider output is advisory: it cannot alter
Inbox state, publish a reply, change Portal behavior, determine Goal/Metric
outcomes, or drive workforce decisions. Reply Drafting is on-demand, editable,
and followed by a separate human Confirm & Publish action.

Raw provider requests/responses, prompts, credentials, private data, and
unredacted errors are prohibited from durable stores, queues, logs, and release
evidence. Deterministic Property Trend results expire after 24 calendar months,
but authorization and source-lifecycle checks may hide them immediately.

Google Review source content has a 30-day source-policy horizon from the latest
fetch, with refresh due at 25 days. Field-level separation and erasure are
implemented and tested, but recurring production erasure remains held until the
backfill, parity, recovery, and cutover evidence in
`docs/operations/review-source-content-cutover.md` is approved. A legal notice
must distinguish the intended horizon from the still-open production activation
evidence.

The repository records the owner's written Google confirmation. Its exact
scope, attachment, effective date, and any conditions must be retained with the
provider approval record; a summary in a draft disclosure is not a substitute
for that source evidence.

## 4. Current retention implementation

The scheduled registry currently enforces or records these main classes:

| Class                                                                                  | Horizon/trigger                          |
| -------------------------------------------------------------------------------------- | ---------------------------------------- |
| Guest response session binding and destination-action receipt                          | Absolute expiry, maximum 24 hours        |
| Guest private-feedback text                                                            | 90 days from submission                  |
| Canonical de-identified Guest response fact/tombstone                                  | 24 calendar months from initial rating   |
| Guest session pseudonyms                                                               | Redact after 24 hours                    |
| Guest network-abuse pseudonyms                                                         | Redact after 7 days                      |
| Published outbox facts, consumer receipts, sync/refresh runs, inbound webhook receipts | 30 days                                  |
| Terminal notifications, terminal email work, and terminal digest evidence              | 90 days; open retry work is retained     |
| Recent Activity storage                                                                | 90 days                                  |
| Policy-decision and significant-action records                                         | 365 days                                 |
| Expiring Google cache                                                                  | Per-row `expires_at`                     |
| Retention-run evidence                                                                 | Indefinite by current engineering policy |

Google import lifecycle, queue quarantine, Review source content, Property/
Organization purge, AI derivatives, account/session data, logs, backups, and
object storage have separate authorities or external configuration. They must
not be collapsed into the static table above. In particular, the final notice
still needs accepted horizons for base Guest metric facts, account deletion,
manager-authored content, Portal configuration/publication history, Inbox
content, Contact Requests, provider reply text, restored backups, and legacy
compatibility rows.

## 5. Deployment and subprocessor facts

The target deployment is a Railway data-cell design with independent `us`,
`europe`, and `global` cells. Each cell has its own database, cache, queue,
object storage, provider boundary, credentials, and release evidence. Work is
never silently failed over or routed to another region.

That target is **not** the current live topology. The repository's latest
recorded observation says the legacy Railway project uses Amsterdam resources
and does not yet match the three-cell graph. `europe` and `global` remain
provisioning in the signed catalogue; repository tests are not evidence that a
cell is live or accepting traffic. Live placement, domains, image digests,
backups/PITR, restore results, log retention, object-store lifecycle, email,
monitoring, and provider configuration must be captured from the platform for
each cell before publication or release.

Accordingly, the legal drafts must not currently claim Neon, a US-only runtime,
an AWS bucket, active PITR/RPO, or a particular monitoring/email region solely
from older documentation. Provider identity, contracting entity, purpose, data
classes, processing location, transfer mechanism, retention, and activation
state need a dated subprocessor record backed by live configuration and
contracts.

## 6. Known deltas in the existing drafts

The three older files remain drafts and must not be published unchanged:

| Draft                         | Material deltas requiring review                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `privacy-notice.md`           | Describes Portal/Guest as future, lists Guest hashes at 90 days, lists action records at 90 rather than the split 90/365-day model, identifies Neon/US and AWS/Paris as live, states US-only processing, states PITR as active, and treats all AI as one inactive feature rather than three independently controlled capabilities. It omits Portal rating/feedback/action metrics, withdrawal behavior, assigned-manager access, Contact Request readiness, publication evidence, and unresolved base-fact horizons. |
| `internal-beta-agreement.md`  | Lists Portal, Guest, Goals, email, and all AI as one disabled set; describes only a single-US-property rollout; identifies old providers/regions; states backup and recovery outcomes without current live evidence; and gives derived metrics/action records a blanket 90-day horizon.                                                                                                                                                                                                                              |
| `google-access-disclosure.md` | Needs the exact written-confirmation artifact verified, current capability vocabulary aligned, production lifecycle activation caveat added, webhook behavior verified against the actual integration, derived-data horizons reconciled, and the final source link kept valid.                                                                                                                                                                                                                                       |

`docs/operations/backup-and-lifecycle.md` also describes Portal upload as merely
allowlist-controlled. The executable fate map is newer and classifies it as
temporarily unavailable until its readiness package closes. That operational
paragraph needs reconciliation in a separate documentation-consistency pass.

## 7. Acceptance checklist outside Engineering authority

Before external beta or production, retain a dated record for each item:

- named counsel acceptance of the privacy notice, beta terms, controller/
  processor roles, legal bases, rights handling, age/eligibility position,
  Guest notice/consent/withdrawal, Contact Request, always-on metrics, manager
  monitoring, and staff-attribution wording;
- accepted retention schedule covering every unresolved class above, including
  backup copies and deletion/restore behavior;
- complete subprocessor and international-transfer schedule backed by live
  configuration and contracts;
- accepted AI notice/version, independently selected Property capabilities,
  provider no-training/minimum-retention terms, and human-publication boundary;
- the original Google written confirmation and a review showing the release
  remains within its conditions;
- named data-protection and incident contacts, response process, effective
  date, notice version, material-change procedure, approval date, review date,
  and expiry/revalidation date; and
- per-cell platform evidence for placement, data flows, backups/recovery,
  observability retention, and activated providers.

Until those records exist, Engineering can make the behavior internally
consistent and keep unavailable capabilities contained, but `LEG-01` cannot be
marked complete.
