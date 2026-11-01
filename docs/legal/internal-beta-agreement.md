---
status: accepted
accepted_by: Bozhidar Denev
accepted_on: 2026-09-08
amended_on: 2026-11-03
---

# Closed Beta Participation Agreement — Reputation Key

**Status:** Accepted for publication and invited-beta use
**Effective date:** 2026-11-03
**Version:** 2.4
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
- Staff participation and attribution;
- in-app required and workflow notifications;
- Recent Activity; and
- internal operational metrics and analytics needed to operate those journeys.

Core analytics are part of the Service. There is no product option to decline
the affected operational metrics while continuing to use the workflow. The
accepted [Privacy Notice version 3.3](/privacy), effective 2026-11-03, forms part
of this agreement and states the applicable roles, legal bases, and rights
process.

### 2.2 Separately controlled beta functions

The following may be offered only when the exact Organization/Property policy
and each feature's release evidence permit it:

- Google import and Business Profile Performance reads;
- external email delivery;
- Portal management and the public Portal/Guest review gateway;
- Guest private rating and optional private feedback;
- staff accounts with a login, personal Portals and their own numbers;
- Contact Request, only after its separate privacy/handling gate closes;
- Property, Portal Group, and individual Portal Goal Programs;
- the Property Google rating goal;
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
optional link tree. In the standard journey, the Guest first leaves a private 1–5 rating. The same
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

A business may switch a Portal to skip the private rating and show the Google
action straight away, with no private rating or note. If Google is unavailable,
the standard private rating journey is offered. Correction and withdrawal of an
existing response remain available.

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

A Property may also have one Google rating goal at a time, which is not a Goal
Program. An AccountAdmin, or a Property Manager with access to the Property,
sets it, in one of two ways. To raise the rating, they set a target above the
rating Google shows for the Property now and choose a weekly pace of new Google
reviews to plan with. To hold the rating, they ask to be told if Google stops
showing the rating it shows now, and choose no pace. The Service works out
progress from the rating and review count that Google reports for the location
and from the Property's cached Google reviews, and for a higher target it also
works out an expected time range. It keeps no review content for the goal. The
goal is shown only to the Organization's AccountAdmins and to Property Managers
with access to that Property. It is never split across Portals, Portal Groups,
or people, and it is not shown to staff. The Service does not use it as a staff
quota, ranking, incentive, or employment input. It does not change the Guest
journey described in section 3.

Staff may see their own scans, rating count and average, a scan target, and,
if the business turns it on, a plain list of colleagues' scan counts. Targets
count scans only. They use no Google data or rating measure. A manager may set
a target on a staff member's Portal or a Group holding it; a Portal that skips
the private rating cannot have a staff scan target.

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

The Organization must also:

- have staff offer the code to every guest, not only those who seem happy;
- never ask staff to collect a set number of Google reviews, or reviews that
  name them;
- never pay or reward staff on ratings, review numbers or scan targets;
- ensure staff do not review their own workplace; and
- tell staff what their numbers show and who sees them.

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

The accepted [Privacy Notice version 3.3](/privacy), effective 2026-11-03, and
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

- Privacy Notice version 3.3, effective 2026-11-03, at `/privacy`;
- Google Business Profile Access Disclosure version 2.4, effective 2026-11-03,
  at `/privacy/google-access-disclosure`;
- the activated-capability schedule in `docs/BETA.md` section 4; and
- the retention, provider, transfer, rights, deployment, and change rules in
  the Privacy Notice.

The signed release manifest, live deployment evidence, and original Google
correspondence remain operational release records rather than additional terms.
An AccountAdmin accepts for the Organization through the invitation flow; each
invited Participant accepts the Participant obligations by joining.

## 13. Changes

This agreement takes effect on 2026-11-03 and is version 2.4. It replaces version 2.3, effective 2026-11-02, which replaced version 2.2, effective 2026-11-01, which replaced
version 2.1, which took effect on 2026-10-14 and had replaced version 2.0, which
took effect on 2026-09-08.

Version 2.1 adds the Property Google rating goal to sections 2.2 and 6, and
section 12 names version 2.1 of the Google Business Profile Access Disclosure,
which describes the same goal. The goal is a separately controlled function that
exists only once a manager sets it. It uses no new class of data and changes no
retention period, provider, or Guest journey, and it adds no duty for
Participants. Goal Programs still do not use Google data, and the existing
limits on staff use, in section 6 and in section 7, still apply as written.

Version 2.1 also corrects the version of the Privacy Notice that sections 2.1,
9, and 12 name. Version 2.0 of this agreement named Privacy Notice version 2.0,
effective 2026-09-08. The Privacy Notice has since been replaced by version 2.1
and then by version 2.2, effective 2026-10-13, which is the version served at
`/privacy`. Version 2.1 of this agreement names version 2.2. This changes no
term of the Privacy Notice.

Nothing else changes. For these reasons the changes in version 2.1 are not
material, and version 2.1 takes effect on the day it is published.

Version 2.2 names the current versions of the two documents it is accepted
with: Privacy Notice version 3.1, effective 2026-11-01, in sections 2.1, 9, and
12, and Google Business Profile Access Disclosure version 2.2, effective
2026-11-01, in section 12. Version 2.1 of this agreement named Privacy Notice
version 2.2, which has since been replaced by versions 2.3, 2.4, 2.5, 3.0, and
3.1. Privacy Notice version 3.1 and Disclosure version 2.2 change how a new
Merchant AI notice takes effect: an AccountAdmin's opt-in for a Property carries
over to each later Merchant AI notice for the AI features already on, and
AccountAdmins are told in the Service what changed afterwards. This agreement
adds no term of its own to that rule and no duty for Participants. Version 2.2
takes effect on the day it is published, on the accountable owner's decision
for the closed beta.

Version 2.3 (2026-11-02) adds the optional Portal journey that skips the private
rating and note and shows the Google action straight away. It takes effect on
release without a waiting period, on the accountable owner’s decision of
2026-11-01 for the two beta Organizations the owner controls. Existing response
correction and withdrawal remain available.

Version 2.3 also updates sections 2.1, 9 and 12 to name Privacy Notice 3.2 and, in section 12, Google Business Profile Access Disclosure 2.3, both effective 2026-11-02.

Version 2.4 (2026-11-03) includes staff accounts, their own numbers, optional
colleague scan counts and scan-only targets, and adds the business's duties
for offering codes and using staff numbers. Competitive Badge/Leaderboard
behavior and Google-review solicitation gamification or review-derived staff
scoring remain excluded. It takes effect on release without a waiting period,
on the accountable owner's decision of 2026-11-01 for the two beta Organizations
the owner controls.
