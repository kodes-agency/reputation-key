---
status: accepted
accepted_by: Bozhidar Denev
accepted_on: 2026-09-08
amended_on: 2026-10-15
---

# Google Business Profile Access Disclosure

**Status:** Accepted for publication
**Effective date:** 2026-10-15
**Version:** 2.1
**Accountable owner:** Bozhidar Denev

## What access Reputation Key requests

Reputation Key requests the OAuth 2.0 scope
`https://www.googleapis.com/auth/business.manage`. Google also supplies the
ordinary OpenID sign-in scopes used during the authorization flow. Reputation
Key does not claim that a narrower review-only Business Profile scope is
currently available.

The connected user must own, or be authorized to manage, the Business Profile
locations they select. A connection does not authorize access to locations
outside that account or to unrelated Properties in Reputation Key.

Current public policy references:

- [Business Profile APIs policies](https://developers.google.com/my-business/content/policies)
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
- [Working with Business Profile review data](https://developers.google.com/my-business/content/review-data)
- [Business Profile real-time notifications](https://developers.google.com/my-business/content/notification-setup)

The public policy references were last refreshed on 2026-08-28. The release
owner must recheck them for each material release because Google's public
policies may change.

## How Google data is used

### Core review management

For an authorized Property, Reputation Key may:

1. import and refresh Business Profile location metadata and reviews;
2. show eligible review content to authorized managers in a Property-scoped
   Inbox;
3. let a manager write, review, and deliberately publish a reply;
4. reconcile whether a reply is currently visible on Google;
5. calculate approved, Property-scoped operational and reputation evidence;
   and
6. use Google Cloud Pub/Sub notifications for new or updated reviews when the
   live integration is configured, with bounded polling and reconciliation as
   the recovery path.

Every external reply publication requires a separate authenticated manager
command. A draft, approval state, AI result, optimistic browser state, or queued
job is never represented as a reply published on Google.

### Public Portal review gateway

A published Portal first asks the guest for a private 1–5 rating owned by the
Property. That private rating is not a Google rating and is not sent to Google.
The same Property-owned Google Review action is then offered with the same
order, timing, copy, and prominence for every private rating. A low private
rating may additionally reveal an optional private-feedback form; it does not
hide or demote the Google action.

Reputation Key records only a qualified selection of the Google action. It
does not claim that the guest completed or published a Google review.

### Property Google rating goal

A Property has at most one Google rating goal at a time. An account
administrator, or a Property manager with access to the Property, sets it, in
one of two ways. To raise the rating, the manager sets a target above the rating
Google shows for the Property now and chooses a weekly pace of new Google
reviews to plan with. To hold the rating, the manager asks to be told if Google
stops showing the rating it shows now, and chooses no pace.

Reputation Key works out progress from the rating and review count that Google
reports for the location and from the Property's cached Google reviews. For a
higher target it also works out an expected time range. It keeps no review
content for the goal. A higher target counts as reached only when Google itself
shows it. The limits on the goal are stated under "Uses the product does not
allow".

### Independently controlled AI capabilities

Google Business Profile API Support supplied written guidance for the exact
per-Property architecture described in the linked request. The repository
therefore treats these as three independent controlled capabilities, not as
one blanket AI permission:

- Review Analysis;
- Reply Drafting; and
- Property Trends, which also depends on Review Analysis.

Each capability remains unavailable unless the merchant has deliberately
enabled that capability for the Property and current notice, provider,
regional, source-content, and release controls all agree. Before external
inference, structured reviewer identity is removed and free text is minimized
and redacted under the approved policy. The provider must not train on the
submitted data and must use the approved minimum-retention and regional
configuration.

AI output is advisory. It cannot publish a reply, change Inbox state, change a
Portal journey, determine Goal or Metric results, or make employment decisions.
Reply Drafting remains editable and publication is a later, separate human
action.

The written response applies to the architecture Google reviewed. It is not an
unrestricted approval for cross-Property analysis, automatic publication,
provider training, new data classes, or materially different retention. See
the [request, response, and internal disposition](../external/google/google-business-profile-ai-policy-response-2026-07-14.md).

## Uses the product does not allow

Reputation Key has no activation path for:

- automatic or AI-triggered review-reply publication;
- AI summaries that combine reviews from unrelated Properties;
- model-provider training on submitted Google content;
- using Google review solicitation, ratings, or review volume for competitive
  staff goals, badges, rankings, or leaderboards; or
- retaining provider-controlled content merely to avoid Google's usage or
  refresh controls.

Portal Goals use the Portal's own qualified scans and private rating metrics.
They do not use Google review completion, Google review rating, or Google review
volume.

The one goal that uses Google data is the Property Google rating goal described
under "How Google data is used". It is shown only to the Organization's account
administrators and to Property managers with access to that Property. It is
never split across Portals, Portal Groups, or people, and it is not shown to
staff. It is not a staff goal, and Reputation Key does not use it as a staff
quota, ranking, incentive, or employment input. It does not change the Portal
guest journey: every guest is offered the same Google Review action, with the
same order, timing, copy, and prominence, whatever the goal.

## Storage and deletion posture

Google-controlled review content—including review text, per-review star rating,
reviewer information and identifiers, Google review identifiers, and reply
text—is isolated as source content. Its application policy is a maximum of 30
calendar days from the latest successful fetch, with refresh due before expiry.
An expired row is ineligible for ordinary reads and external processing.

Approved derivative metadata is stored separately and must not reproduce raw
content, identity, exact replies, or reversible content fingerprints. Its
retention follows the separately approved product/privacy schedule; “derived”
does not mean “retain forever.”

The repository implements field-level source separation, eligibility fences,
and erasure/recovery tooling. Recurring production erasure remains a release
gate pending backfill, parity, restore-boundary, and live-cell evidence. This
disclosure therefore does not claim that repository tests prove live deletion.

Disconnecting Google access stops new provider work and invalidates the
Property's Google destination. Token revocation, source erasure, derived-data
handling, backups, and independently retained manager-authored history follow
their distinct accepted lifecycle procedures. The time commitments are stated
in the accepted retention schedule rather than inferred from this disclosure.

## Security and operational controls

The repository is designed so that:

- OAuth credentials are encrypted and used only through the provider boundary;
- raw provider content and identifiers are excluded from domain-event payloads,
  ordinary logs, traces, notifications, analytics, and release evidence;
- authorization is rechecked for the exact Organization and Property;
- provider notifications are authenticated and deduplicated before work is
  accepted;
- source expiry and disconnection stop new content use; and
- release tooling verifies one signed candidate and its provider-approval
  evidence before promotion.

These are implementation requirements. Before an affected capability is
activated, the release record must separately prove the deployed cell,
encryption/key ownership, token revocation, logging filters, backups/restores,
monitoring, incident contacts, and provider configuration.

## Incident and change control

Suspected credential misuse, unauthorized Google access, or exposed Google
content enters the security incident process immediately. The operator
contains affected provider capability, preserves content-free evidence,
rotates or revokes affected authority, assesses scope, and follows the approved
Google and data-subject notification procedures. This disclosure does not state
one universal notification deadline; applicable law and the provider terms
determine the deadline.

The release owner must review the public Google policies, the original written
response and its conditions, the actual OAuth/Pub/Sub configuration, and the
signed release manifest whenever the data flow, provider, region, retention,
AI purpose, or publication behavior changes.

## Release evidence required before activation

- the original Google email with headers, sender, time, and support case or
  equivalent provenance retained outside public source control;
- the exact scope and conditions of that response reviewed against the release;
- live OAuth scope, Pub/Sub topic/subscription, and project approval evidence;
- accepted raw-content, derivative, disconnect, backup, and restore lifecycle;
- named provider, region, no-training, and minimum-retention evidence for any
  enabled AI capability; and
- dated accountable-owner, product, security, and provider-policy acceptance.

## Changes

This disclosure takes effect on 2026-10-15 and is version 2.1. It replaces
version 2.0, which took effect on 2026-09-08.

Version 2.1 adds the subsection on the Property Google rating goal under "How
Google data is used", and a paragraph on the limits of that goal under "Uses the
product does not allow". Everything else is unchanged, including the
prohibition on using Google review solicitation, ratings, or review volume for
competitive staff goals, badges, rankings, or leaderboards, and the statement
that Portal Goals do not use Google review completion, rating, or volume. The
goal uses no new class of Google data, keeps no review content, changes no
retention period or provider, and changes nothing a guest sees, and it exists
only once a manager sets it. For these reasons it is not a material change, and
version 2.1 takes effect on the day it is published.
