# Privacy Notice — Reputation Key Closed Beta

**Status:** Candidate draft — pending counsel, live-provider, and release review
**Date:** 2026-08-28
**Version:** 2.0-draft
**Accountable owner:** Bozhidar Denev

> **Do not publish this draft.** It describes the intended closed-beta product
> and distinguishes repository controls from live evidence. It still requires
> an accepted retention schedule, subprocessor schedule, rights procedure,
> international-transfer analysis, effective date, and named counsel approval.

## 1. About this notice

Reputation Key helps authorized business managers receive and handle Google
Business Profile reviews, publish deliberate human-approved replies, operate a
Property-owned public review gateway, and understand Property and Portal
performance. Kodes Agency operates the closed beta.

This notice covers two groups:

- **Participants** — invited account administrators and property managers who
  use the authenticated manager application; and
- **Guests** — people who open a published Portal and may submit a private
  rating, optional private feedback, or choose a destination link.

The final notice must state the accepted controller/processor roles and legal
bases. Engineering does not decide those questions.

## 2. Information handled by the Service

### Participant and business information

- invited account details, such as name and email address;
- Organization and Property profile, locale, responsibility, and access data;
- content a Participant deliberately authors, including review replies, Inbox
  notes, Portal configuration, and beta feedback;
- authentication/session and security-control records; and
- content-free operational history for significant product, support, privacy,
  policy, and release actions.

Suggestions sent through native beta feedback are text-only. For an eligible
Bug report, a Participant may separately choose to create a preview containing
only quantized, text-free layout blocks. The preview excludes page text, field
values, URLs, pixels, images, account details, and ordinary screen replay, and
can be reviewed or removed before submission.

### Google Business Profile information

After an authorized Participant connects Google, the Service may fetch
Property/location metadata and review source content, including reviewer
information, per-review rating, review text and language, review time, Google
identifiers, and current reply content/state. The Service also stores
manager-authored reply workflow and reconciliation evidence.

Google-controlled source content is isolated from longer-lived application
facts. Its intended maximum cache horizon is 30 calendar days from the latest
successful fetch, with refresh due before expiry. Production erasure and
restore-boundary evidence remains a release gate; this draft does not treat a
repository test as proof of live deletion.

See the separate [Google Business Profile Access Disclosure](google-access-disclosure.md).

### Portal and Guest information

A Portal is primarily a Property-owned review gateway and secondarily an
optional link tree. The standard journey is:

1. the Guest submits a private 1–5 rating to the Property;
2. the same Google Review action is offered for all five ratings with the same
   order, timing, copy, and prominence;
3. when the private rating is at or below the Portal's inclusive threshold
   (default `3`), the Guest may also leave optional private feedback; and
4. optional secondary links may follow the primary review actions.

The private rating is not a Google rating and is not sent to Google. The
Service can record that the Guest selected the Google action, but cannot know
or claim that a Google review was completed or published.

Depending on enabled Portal features, the Service may handle:

- a qualified scan/visit fact with Portal, Property, source (`qr`, `nfc`, or
  `direct`), and time;
- the private 1–5 rating and correction/withdrawal lineage;
- optional private feedback of at most 2,000 characters;
- the first qualified Google or secondary-destination selection;
- a signed response-session binding used for recovery, duplicate prevention,
  one correction, and withdrawal; and
- a keyed, Organization/Portal/action/day-separated network-pressure pseudonym
  used only for abuse pressure.

Raw Guest IP addresses are not persisted as analytics or identity. The
network-pressure pseudonym contains no response, destination, session, or
content identity and is not a staff-performance signal.

Contact Request is a separate controlled capability. Public contact collection
is currently disabled. It cannot be enabled until its email-only purpose,
notice/consent, manager access, delivery, encryption/key lifecycle, withdrawal,
and privacy procedure are accepted. Phone collection is outside the beta.
Guest media submission is unavailable.

### Operational and monitoring information

The Service uses content-minimized request, error, performance, health, job,
and security signals. Repository controls prohibit request/response bodies,
cookies, credentials, raw tenant content, and unapproved identifiers from
ordinary monitoring. Native feedback text is submitted deliberately and held
separately from application telemetry.

The final provider schedule must identify actual monitoring, email, hosting,
database, cache/queue, object-storage, and AI providers and their configured
regions and retention. Older provider names in superseded drafts are not live
evidence.

## 3. Why information is used

The Service uses information to:

- authenticate invited Participants and enforce Organization/Property access;
- import eligible Google reviews, maintain the Inbox, and reconcile replies;
- publish a reply only after a separate authorized human command;
- operate Portals, private ratings, private-feedback workflows, and approved
  destination links;
- provide core operational analytics, including qualified scans, rating count,
  rating average, and service/reply evidence;
- evaluate non-competitive Property, Portal Group, and individual Portal Goal
  Programs using qualified scans, private-rating count, and private-rating
  average;
- deliver required and configured notifications to the appropriate responsible
  managers;
- prevent abuse, diagnose failures, recover durable work, and protect tenants;
  and
- improve the closed beta using deliberately submitted feedback.

Core analytics are part of the Service and do not have a product toggle to
decline collection while continuing to use the affected workflow. The final
notice and lawful-basis/rights analysis for that design require counsel
acceptance.

Portal and staff-attribution metrics are decision-support evidence. The beta
does not provide competitive rankings, bottom lists, automatic employment
decisions, or review-derived staff scoring.

## 4. Who can see information

- Account administrators can manage their Organization and view authorized
  Organization-wide product information.
- Property managers see only Properties they can currently access.
- Portal private feedback and Portal workflow notifications are limited to the
  current responsible managers assigned to that Portal. A creator is assigned
  initially when eligible; creation is not permanent exclusive ownership.
- Account administrators are a recovery recipient only when a Portal has no
  eligible responsible manager; notifications do not fan out to every Property
  Manager.
- Manager-authored notes and private feedback do not enter Guest analytics,
  public pages, AI input, or routine logs.
- Service providers receive only the data required for their accepted purpose
  and configuration.

The final notice must attach the verified subprocessor and international-
transfer schedule before publication.

## 5. Independently controlled AI features

Review Analysis, Reply Drafting, and Property Trends are independent
Property-level controlled capabilities. Property Trends depends on Review
Analysis. None becomes available merely because code exists.

Each capability requires current Property authorization, an accepted notice
version, an approved provider/deployment and region, a current source-content
policy, and release readiness. Before external inference, structured reviewer
identity is removed and free text is minimized and redacted. Private Portal
ratings, private feedback, Contact Requests, Inbox notes, manager text, and
Guest media are outside the AI input boundary.

Provider output is advisory. It cannot publish a Google reply, change Inbox
state, determine metrics/goals, change the Guest journey, or make an employment
decision. A Reply Draft remains editable and is followed by a separate human
Confirm & Publish action.

Cross-Property AI summaries, automatic AI reply publication, and provider
training on submitted Google content have no activation path.

## 6. Current retention posture

The following horizons are implemented or represented in the repository. They
remain subject to the final accepted retention matrix and deployed evidence.

| Information class                                                                      | Current repository horizon or trigger                                              |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Guest response session and destination-action receipt                                  | Absolute expiry, no more than 24 hours                                             |
| Guest private-feedback text                                                            | No more than 90 days; same signed session may withdraw for 24 hours                |
| Canonical de-identified Guest response fact/tombstone                                  | 24 calendar months from the initial rating                                         |
| Guest session diagnostic pseudonym                                                     | Redacted after 24 hours                                                            |
| Guest network-pressure record                                                          | Deleted at exact seven-day expiry                                                  |
| Published outbox facts, consumer receipts, sync/refresh runs, inbound webhook receipts | 30 days                                                                            |
| Terminal notifications/email/digest evidence                                           | 90 days; open retry work is retained                                               |
| Recent Activity                                                                        | 90 days                                                                            |
| Policy-decision and significant-action records                                         | 365 days under the current engineering policy                                      |
| Google-controlled source content                                                       | Per-row source-policy expiry; intended maximum 30 days from latest fetch           |
| Optional masked Bug layout                                                             | Application expiry no later than 30 days; provider deletion still needs live proof |
| Organization Export object                                                             | At most seven days; single-use retrieval authority at most 24 hours                |

Reading, viewing, moderating, or archiving content does not extend its content
deadline.

The final schedule still needs accepted rules for base Guest visit/destination
facts, legacy Guest rows, account/member deletion, manager-authored replies and
notes, Portal configuration/publication history, Contact Requests, provider
reply content, AI derivatives, logs, quarantine, object storage, restored
backups, and independently retained operational evidence. Until those are
accepted and executable, this draft must not state a universal deletion promise.

## 7. Choices, corrections, and withdrawal

- A Guest may correct the private rating once and may withdraw the whole
  response within 24 hours of the initial rating.
- Eligible private feedback may be withdrawn within its 24-hour window.
- Withdrawing a response removes the effective rating and any still-effective
  feedback, while retaining only bounded content-free lineage needed for
  correctness and abuse prevention.
- Choosing the Google Review action or an optional link is voluntary.
- Contact Request remains disabled until its separate consent and withdrawal
  contract is accepted.
- Required service, security, and account notices cannot be disabled. Other
  notification preferences follow their product policy.

Participants and Guests may have rights of access, correction, objection,
withdrawal, deletion, restriction, or portability depending on applicable law
and the Operator's role. The final notice must name the verified request channel,
identity-verification procedure, response time, exceptions, appeal/escalation
path, and backup implications. Organization Export foundations exist but the
complete 17-context workflow is not yet activated; this draft does not promise
an unavailable self-service export.

## 8. Security and deployment posture

Repository controls include tenant- and Property-scoped authorization,
encrypted provider credentials, secure transport requirements, source-content
isolation, content-minimal durable facts, monitoring scrubbing, bounded jobs,
and signed immutable release promotion.

The target beta topology is exactly one Railway Data Cell, `cell-us`, in
Railway's US West/California placement. All supported countries explicitly
route to this one beta cell; dormant `europe` and `global` identifiers are
denied and are not additional beta deployments. This target is not proof of
current live placement.

Before publication, retain the live `cell-us` service/provider inventory,
domains, image digests, encryption/key evidence, backup/PITR and restore test,
object lifecycle, monitoring/email retention, incident routing, and data-flow/
transfer record. Do not infer those facts from repository configuration alone.

## 9. Changes and contact

The final notice must identify the effective date, material-change process,
data-protection contact, security contact, and approved request channel. The
closed beta must notify affected Participants of material changes under the
accepted procedure before the changes take effect.

Current accountable product/security contact for draft review: **Bozhidar
Denev**.

---

_Candidate privacy text only. It has not been approved by legal counsel and is
not evidence that a provider or deployment is live._
