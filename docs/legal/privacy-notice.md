---
status: accepted
accepted_by: Bozhidar Denev
accepted_on: 2026-09-08
---

# Privacy Notice — Reputation Key Closed Beta

**Status:** Accepted for publication
**Effective date:** 2026-09-08
**Version:** 2.0
**Accountable owner:** Bozhidar Denev

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

Kodes Agency, operating as Reputation Key, is the controller for Participant
account data, security and monitoring signals, and beta feedback. Participant
account data and beta feedback are processed to perform the closed beta
agreement. Security, abuse-prevention, and diagnostic signals are processed for
Kodes Agency's legitimate interests in protecting and operating the Service.

For Google Business Profile content and Guest Portal submissions, the
Organization is the controller and Kodes Agency is its processor, acting on the
Organization's documented instructions. Guest private ratings and feedback are
voluntary submissions processed for the Organization's legitimate interest in
service quality.

AI features run only after an Organization administrator records an opt-in to
the current Merchant AI notice. A new notice version requires a new recorded
opt-in.

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
restore-boundary evidence remains a release gate. This notice does not treat a
repository test as proof of live deletion.

See the separate [Google Business Profile Access Disclosure](/privacy/google-access-disclosure).

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

The Service uses the following providers:

| Provider | Purpose                                        | Processing location and retention or use controls                                                                                                                                                                                                                                          |
| -------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Railway  | Hosting, PostgreSQL, Redis, and object storage | United States, US West                                                                                                                                                                                                                                                                     |
| OpenAI   | AI inference                                   | Global API endpoint with no residency commitment; prompt cache up to 24 hours; ordinary abuse-monitoring retention generally no more than 30 days, subject to documented legal or safety exceptions; API data is not used for training unless Reputation Key's OpenAI organization opts in |
| Google   | Business Profile APIs and OAuth                | Independent controller of Business Profile data                                                                                                                                                                                                                                            |
| Resend   | Transactional email                            | United States                                                                                                                                                                                                                                                                              |
| Sentry   | Error monitoring                               | United States; used only when a DSN is configured, and no DSN is configured today                                                                                                                                                                                                          |

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
decline collection while continuing to use the affected workflow. The
controller roles and legal bases stated in section 1 apply to these uses.

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

All providers in the schedule process personal data in the United States.
The beta has no EU deployment. OpenAI uses a global API endpoint and gives no
provider residency commitment, so this notice makes no US-only provider
processing promise.

For transfers from the EU or UK, Reputation Key relies on each provider's
data-processing terms incorporating the EU Standard Contractual Clauses and,
where the provider is certified, the EU-U.S. Data Privacy Framework.

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

The following accepted horizons are implemented or represented in the
repository:

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

The accepted rules for the remaining information classes are:

- base Guest visit and destination facts are content-free and kept for 24
  months;
- there are no legacy Guest rows: the beta database started empty on
  2026-09-05;
- account and member data is kept for the life of the membership and purged by
  the Organization closure workflow;
- manager-authored replies and notes, Portal configuration, and publication
  history are kept for the life of the Organization and purged at closure;
- Contact Requests are disabled;
- provider reply content follows the 30-day source-content policy;
- de-identified AI derivatives are kept for 24 months and withheld immediately
  when authorization is withdrawn;
- application logs are content-minimized and held by the hosting provider for
  no more than 30 days;
- there is no quarantine retention class because no quarantine tables remain;
- Organization Export objects are kept for no more than seven days, and their
  retrieval links for no more than 24 hours; and
- the hosting provider keeps encrypted backups for no more than 30 days. Every
  erasure is recorded in the append-only `backup_erasure_ledger` and re-applied
  after any restore.

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
and the controller's role. Send a request to
[denev@kodes.agency](mailto:denev@kodes.agency). Participants verify their
identity by writing from their registered address. Guests present the signed
response link or the details of their submission. Reputation Key responds
within 30 days.

To escalate a request, write to the same address and mark the message
“escalation.” A Participant or Guest may also contact the competent supervisory
authority. The backup rules in section 6 apply to erasure requests. Organization
Export is not available as a self-service workflow during the beta.

## 8. Security and deployment posture

Repository controls include tenant- and Property-scoped authorization,
encrypted provider credentials, secure transport requirements, source-content
isolation, content-minimal durable facts, monitoring scrubbing, bounded jobs,
and signed immutable release promotion.

The beta has one production deployment on Railway in the United States (US
West); no EU deployment exists.

## 9. Changes and contact

This notice takes effect on 2026-09-08 and is version 2.0. Material changes will
be announced to Participants by email at least 14 days before they take effect.
The version and effective date will remain shown on this page.

The data-protection, security, and rights-request contact is
[denev@kodes.agency](mailto:denev@kodes.agency).
