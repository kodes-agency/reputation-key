---
status: accepted
accepted_by: Bozhidar Denev
accepted_on: 2026-09-08
---

# Closed Beta Participation Agreement — Reputation Key

**Status:** Accepted for publication and invited-beta use
**Effective date:** 2026-09-08
**Version:** 2.0
**Accountable owner:** Bozhidar Denev

## 1. Parties and beta purpose

This agreement governs the closed beta of Reputation Key (the “Service”)
between Kodes Agency, which operates the Service as Reputation Key (the
“Operator”), and the invited beta business (the “Organization”) acting through
its AccountAdmin or AccountAdmins. Invited users authorized by the Organization
are “Participants.” Each Participant accepts the Participant obligations by
joining; only an AccountAdmin acts for and binds the Organization.

The closed beta validates a review-management service before broader release.
The Service helps authorized managers connect Google Business Profile, handle
reviews in a Property-scoped Inbox, publish deliberate human-approved replies,
operate public review gateways, and use bounded manager decision-support
metrics.

## 2. Product scope

### 2.1 Core closed-beta functions

Subject to global safety stops, Organization suspension, access policy, and
release readiness, the core product includes:

- invite-only identity, authentication, and session management;
- authorized Organization and Property management;
- Google Business Profile connection and human-confirmed reply publication;
- Review and Inbox workflows, including assignment, escalation, manager notes,
  private-feedback handling, and response evidence;
- Property and fleet dashboards;
- Staff participation/attribution foundations without Member login;
- in-app required and workflow notifications;
- Recent Activity; and
- internal operational metrics and analytics needed to operate those journeys.

Core analytics are part of the Service. There is no product option to decline
the affected operational metrics while continuing to use the workflow. The
accepted [Privacy Notice version 2.0](/privacy), effective 2026-09-08, forms part
of this agreement and states the applicable roles, legal bases, and rights
process.

### 2.2 Separately controlled beta functions

The following may be offered only when the exact Organization/Property policy
and each feature's release evidence permit it:

- Google import and Business Profile Performance reads;
- external email delivery;
- Portal management and the public Portal/Guest review gateway;
- Guest private rating and optional private feedback;
- Contact Request, only after its separate privacy/handling gate closes;
- Property, Portal Group, and individual Portal Goal Programs;
- Review Analysis;
- Reply Drafting; and
- Property Trends, which also depends on Review Analysis.

Code presence is not activation. The activated-capability schedule is the fate
table in `docs/BETA.md` section 4, backed by
`src/shared/governance/capability-fate.ts`. Its current policy and release gates
determine which controlled capabilities the cohort may use.

### 2.3 Excluded or unavailable functions

The closed beta does not provide:

- public registration or self-service creation of a second Organization;
- ordinary self-service destructive Property erasure;
- Team product behavior (Portal Groups are the accepted grouping model);
- Member login;
- Guest media submission;
- Portal image upload until its separate readiness package closes;
- competitive Badge/Leaderboard behavior;
- automatic or AI-triggered Google reply publication;
- cross-Property AI summaries; or
- Google-review solicitation gamification or review-derived staff scoring.

Retained legacy rows or compatibility code do not make an excluded function
available.

## 3. Portal and Guest behavior

A Portal is primarily a Property-owned review gateway and secondarily an
optional link tree. The Guest first leaves a private 1–5 rating. The same
Property-owned Google Review action is then offered with the same order, timing,
copy, and prominence for every rating. A rating at or below the Portal's
inclusive threshold (default `3`) may additionally reveal optional private
feedback. It never hides or demotes the Google action.

The private rating is not sent to Google. Reputation Key may record that a
Guest selected the Google Review action, but does not claim that the Guest
completed or published a Google review.

Portal private feedback is limited to current managers assigned responsibility
for that Portal. The creator is assigned initially when eligible, but creation
is not permanent exclusive ownership. Account administrators are used only for
the explicit unowned recovery state; notices do not fan out to every Property
Manager.

Guests may use the signed response session for the documented correction and
24-hour withdrawal windows. Contact Request is email-only if later activated;
phone collection and Guest media remain outside the beta.

## 4. Google Business Profile

Participants may connect only Business Profile locations they own or are
authorized to manage. The Service requests the
`https://www.googleapis.com/auth/business.manage` OAuth scope for its approved
Business Profile operations.

Every reply publication requires a separate authenticated manager command. A
draft, approval state, AI output, queue acknowledgement, or optimistic browser
state is not publication evidence. The Service reconciles current provider
truth and distinguishes a reply observed live on Google from a RepKey-confirmed
publication.

Google-controlled review content is subject to the applicable source-content
policy, including the intended maximum 30-calendar-day cache horizon from the
latest successful fetch. Approved derivative metadata remains Property-scoped
and follows a separate accepted retention schedule.

The Operator has written Google Business Profile API Support guidance for the
exact per-Property AI design. That correspondence is conditional evidence, not
an unrestricted approval. Each release remains within its scope and retains the
original correspondence, the processing restatement, and the current
public-policy review.

The accepted [Google Business Profile Access Disclosure](/privacy/google-access-disclosure)
forms part of this agreement.

## 5. AI capability boundaries

Review Analysis, Reply Drafting, and Property Trends are independent,
off-by-default Property capabilities. Each requires deliberate merchant
authorization plus the accepted notice, provider, source-content, and release
controls.

The beta uses OpenAI's global API endpoint. It has no regional OpenAI processing
configuration and no provider residency commitment. Requests use 24-hour prompt
caching. OpenAI API data is not used for training unless Reputation Key's
OpenAI organization opts in, and the beta has no activation path for provider
training.

Before external inference, structured reviewer identity is removed and free
text is minimized and redacted. Private Portal ratings, private feedback,
Contact Requests, Inbox notes, manager-authored text, and Guest media are not AI
inputs.

AI output is advisory and cannot publish a reply, change workflow status,
control the Guest journey, determine Goal/Metric outcomes, or make an
employment decision. A Reply Draft remains editable and requires a later
human Confirm & Publish action.

## 6. Goal and staff-use limits

Goal Programs may use qualified Portal scans, private-rating count, and
private-rating average for a Property, Portal Group, or individual Portal. They
do not use completed Google reviews, Google review ratings, or Google review
volume.

Staff attribution, metrics, and goals are non-competitive manager
decision-support evidence. Badge and Leaderboard behavior is unreachable. The
Service provides no ordinal ranking, bottom list, composite staff score, or
automatic consequence, and it must not be used to make an employment decision.

## 7. Participant responsibilities

Participants must:

1. use only Organizations, Properties, and Google locations they are authorized
   to manage;
2. keep invitations, credentials, recovery material, and sessions confidential;
3. review every external reply and use the separate publication command only
   when authorized by the business;
4. avoid unlawful, misleading, discriminatory, abusive, or prohibited content;
5. not use the Service to create competitive staff rankings or automatic
   employment decisions;
6. promptly report suspected unauthorized access, data mismatch, unsafe
   external effect, or privacy/security concern through the accepted support
   channel; and
7. cooperate with bounded beta investigations and recovery steps without
   attempting to bypass policy, provider, or tenant boundaries.

## 8. Operator responsibilities and beta limitations

For each release, the Operator maintains an evidence-backed release procedure
covering:

- tenant/Property isolation and access revocation;
- provider credentials and deliberate external effects;
- source-content expiry and lifecycle recovery;
- monitoring, incident response, support ownership, and participant
  communications;
- backup/PITR, restore, rollback/forward-fix, and post-restore lifecycle fences;
- privacy requests and Organization/Property closure;
- immutable candidate promotion and stop controls; and
- the enabled controlled-capability list.

Repository implementation is not proof of a live service. The beta has no
contractual uptime SLA, service credits, or 24/7 support. Support hours, service
levels, warranties, disclaimers, and liability terms are not agreed, and this
agreement does not create them.

## 9. Data handling, retention, and providers

The accepted [Privacy Notice version 2.0](/privacy), effective 2026-09-08, and
its retention and provider schedules form part of this agreement. They cover
Participant, Google source, Portal and Guest, manager-authored, AI-derived,
monitoring, export, backup, and independently retained evidence classes.

The beta has one Railway deployment in the United States, in Railway's US
West/California placement, and no EU deployment. OpenAI processing uses its
global API endpoint with no regional configuration or residency commitment.
The provider inventory, processing locations, transfer mechanism, retention,
backup rules, and privacy and security contact are stated in the Privacy
Notice.

Older references to Neon, AWS Paris, a single-US-property pilot, or live PITR
do not describe this agreement and are not release evidence unless independently
verified for the signed candidate.

## 10. Access, export, withdrawal, and closure

The accepted Privacy Notice section 7 governs Participant and Guest requests
for access, correction, withdrawal, deletion, restriction, and portability
where applicable. It sets the channel, identity verification, 30-day response
period, escalation path, and backup effects.

Property Archive and recovery-window Restore are distinct from permanent
erasure. Permanent Property erasure is AccountAdmin-requested and support-
mediated. Organization closure uses a staged recoverable-to-irreversible
lifecycle and must not silently reactivate Google, Portals, AI, notifications,
or schedules after cancellation.

Organization Export foundations use context-owned contributions, encrypted
private storage, single-use retrieval authority, and bounded expiry. The full
17-context workflow remains inactive until every contributor and live storage
gate is complete. This agreement does not promise unavailable self-service
export or deletion.

## 11. Term, suspension, and exit

The Operator may pause a capability, Property, Organization, cohort, or the
beta when safety, provider, policy, operational, or legal conditions require
containment. A pause preserves required evidence and does not imply deletion.

Participant withdrawal, Organization closure, Google disconnection, data
export, retained evidence, recovery windows, irreversible boundaries, notices,
and termination effects follow the accepted Privacy Notice and the documented
lifecycle and retention rules. Only workflows enabled by the activated-
capability schedule are available.

## 12. Acceptance package

This agreement is accepted together with:

- Privacy Notice version 2.0, effective 2026-09-08, at `/privacy`;
- Google Business Profile Access Disclosure version 2.0, effective 2026-09-08,
  at `/privacy/google-access-disclosure`;
- the activated-capability schedule in `docs/BETA.md` section 4; and
- the retention, provider, transfer, rights, deployment, and change rules in
  the Privacy Notice.

The signed release manifest, live deployment evidence, and original Google
correspondence remain operational release records rather than additional terms.
An AccountAdmin accepts for the Organization through the invitation flow; each
invited Participant accepts the Participant obligations by joining.
