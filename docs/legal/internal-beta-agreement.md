# Closed Beta Participation Agreement — Reputation Key

**Status:** Candidate draft — pending counsel and exact-release acceptance
**Date:** 2026-08-28
**Version:** 2.0-draft
**Accountable owner:** Bozhidar Denev

> **Do not publish or accept this draft.** It is an engineering-aligned input
> for counsel. The final agreement must bind the accepted privacy notice,
> provider/subprocessor schedule, retention schedule, support terms, release
> manifest, and live `cell-us` evidence.

## 1. Parties and beta purpose

This draft is intended to govern a closed beta of Reputation Key (the
“Service”) operated by Kodes Agency (the “Operator”) for invited businesses and
their authorized users (“Participants”). Counsel must finalize the parties,
definitions, authority, governing law, and signature/acceptance method.

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
- Staff participation/attribution foundations without Staff User login;
- in-app required and workflow notifications;
- Recent Activity; and
- internal operational metrics and analytics needed to operate those journeys.

Core analytics are part of the Service. There is no product option to decline
the affected operational metrics while continuing to use the workflow. The
final agreement/privacy notice must contain counsel-approved wording and rights
analysis for this design.

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

Code presence is not activation. The final accepted schedule must name which
controlled capabilities are enabled for the cohort and the exact notice/policy
versions that govern them.

### 2.3 Excluded or unavailable functions

The closed beta does not provide:

- public registration or self-service creation of a second Organization;
- ordinary self-service destructive Property erasure;
- Team product behavior (Portal Groups are the accepted grouping model);
- Staff User login;
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
an unrestricted approval. The final release must remain within its scope and
retain the original correspondence and current public-policy review.

See the accepted version of the [Google Business Profile Access Disclosure](google-access-disclosure.md).

## 5. AI capability boundaries

Review Analysis, Reply Drafting, and Property Trends are independent,
off-by-default Property capabilities. Each requires deliberate merchant
authorization plus the accepted notice, provider/deployment, region,
source-content, and release controls.

Before external inference, structured reviewer identity is removed and free
text is minimized/redacted. The approved provider must not train on submitted
content and must use the approved minimum-retention and regional configuration.
Private Portal ratings, private feedback, Contact Requests, Inbox notes,
manager-authored text, and Guest media are not AI inputs.

AI output is advisory and cannot publish a reply, change workflow status,
control the Guest journey, determine Goal/Metric outcomes, or make an
employment decision. A Reply Draft remains editable and requires a later
human Confirm & Publish action.

## 6. Goal and staff-use limits

Goal Programs may use qualified Portal scans, private-rating count, and
private-rating average for a Property, Portal Group, or individual Portal. They
do not use completed Google reviews, Google review ratings, or Google review
volume. They provide non-competitive manager decision support without ordinal
rankings, bottom lists, composite scores, or automatic consequences.

The final agreement and participant notice must explain any staff attribution,
manager monitoring, permitted purpose, correction/dispute process, and
employment-use prohibition accepted for the cohort. The Service must not be
used as the sole basis for hiring, termination, discipline, compensation, or
other adverse employment action.

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

Before accepting this agreement, the Operator must have an evidence-backed
release procedure for:

- tenant/Property isolation and access revocation;
- provider credentials and deliberate external effects;
- source-content expiry and lifecycle recovery;
- monitoring, incident response, support ownership, and participant
  communications;
- backup/PITR, restore, rollback/forward-fix, and post-restore lifecycle fences;
- privacy requests and Organization/Property closure;
- immutable candidate promotion and stop controls; and
- the enabled controlled-capability list.

The repository contains many of these controls, but repository implementation
is not proof of a live service. The final agreement must state only service
levels, support hours, recovery objectives, warranties, disclaimers, and
liability terms that counsel and operations have accepted for the exact
release. This draft deliberately does not invent them.

## 9. Data handling, retention, and providers

The accepted [Privacy Notice](privacy-notice.md) and its retention/subprocessor
schedules form part of the final beta package. They must cover Participant,
Google source, Portal/Guest, manager-authored, AI-derived, monitoring, export,
backup, and independently retained evidence classes.

The target deployment is exactly one Railway Data Cell, `cell-us`, in
Railway's US West/California placement. All supported countries route to that
single beta cell; dormant `europe` and `global` identifiers are not beta
deployments. Repository configuration does not prove that topology is live.
The final agreement must bind the verified provider inventory, processing
locations, transfer mechanism, retention, backup, and incident contacts.

Older references to Neon, AWS Paris, a single-US-property pilot, or live PITR
are not release evidence and must not be copied into the final agreement unless
independently verified for the signed candidate.

## 10. Access, export, withdrawal, and closure

The final beta package must provide an accepted, supportable process for
Participant and Guest access, correction, withdrawal, deletion, restriction,
and portability where applicable. It must name identity verification,
authorization, response timing, exceptions, escalation, and backup effects.

Property Archive and recovery-window Restore are distinct from permanent
erasure. Permanent Property erasure is AccountAdmin-requested and support-
mediated. Organization closure uses a staged recoverable-to-irreversible
lifecycle and must not silently reactivate Google, Portals, AI, notifications,
or schedules after cancellation.

Organization Export foundations use context-owned contributions, encrypted
private storage, single-use retrieval authority, and bounded expiry. The full
17-context workflow remains inactive until every contributor and live storage
gate is complete. The final agreement must not promise unavailable self-service
export or deletion.

## 11. Term, suspension, and exit

The Operator may pause a capability, Property, Organization, cohort, or the
beta when safety, provider, policy, operational, or legal conditions require
containment. A pause preserves required evidence and does not imply deletion.

The final agreement must define Participant withdrawal, Organization closure,
Google disconnection, data export, retained evidence, recovery window,
irreversible boundary, final notice, and termination effects using the accepted
lifecycle/retention schedule. Until those workflows and approvals are complete,
this candidate draft cannot be accepted.

## 12. Acceptance package

The final agreement must be accepted together with:

- the exact Privacy Notice and Google disclosure revisions;
- the enabled capability and cohort schedule;
- the accepted retention and subprocessor/transfer schedules;
- the signed release manifest and live `cell-us` evidence;
- the original Google written confirmation and current policy review;
- named product, security, operations, support, privacy, and counsel approvals;
  and
- effective, review, and revalidation/expiry dates.

---

**Draft review contact:** Bozhidar Denev

_Candidate agreement only. It has not been approved by legal counsel and is not
an offer or accepted contract._
