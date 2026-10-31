---
status: accepted
date: 2026-10-31
---

# 0075 — A standing AI opt-in renews automatically

Every merchant AI notice that changed data use paused AI on every Property until
an AccountAdmin acknowledged it again, one Property page at a time. After the
2026-10-30 notice, 23 of the beta's 31 enabled Properties were still paused more
than a day later, the largest among them. On 2026-10-31 the owner decided that a
merchant opts in once and later notice changes apply automatically, announced
after the fact, with no objection step. This amends
[ADR 0074](0074-merchant-ai-consent-follows-the-notice.md) and keeps the
processing boundary of
[ADR 0031](0031-google-source-content-and-ai-processing-boundary.md): the opt-in
is still deliberate, recorded, per Property and per capability.

## Decision

1. **The opt-in stands.** An AccountAdmin opts in once per capability per
   Property, through the existing ceremonies (the Property's AI page, the import's
   multi-Property step). When a later merchant AI notice is served, the Property
   moves to it automatically with exactly the capabilities and source scope it
   had. Nobody acknowledges the new notice and there is no objection step;
   turning AI off stays available at any time.
2. **Only what is on is renewed.** Revoked and disabled heads are never touched.
   A capability that is off, or a new capability, still needs the explicit
   opt-in of the enable or change command with an acknowledgement of the served
   notice.
3. **Mechanism.** A worker sweep, at worker start and every 10 minutes, selects
   enabled heads whose notice is no longer in force and renews each Property
   in its own transaction through the ordinary `change` transition and
   `apply_merchant_ai_transition_v1`. The evidence row carries reason
   `standing_renewal`, one ceremony id per run, a deterministic idempotency key
   per Property and target notice, and as actor the AccountAdmin whose opt-in
   stands: the actor of the Property's latest consent evidence while they are
   still a live owner, else the longest-standing live owner (rechecked under the
   transition's locks). The renewal never changes the Property's source, and a
   replayed key is a no-op. A run that finds nothing is one indexed read.
4. **Epochs and drafts.** Epochs follow ADR 0074: only capabilities whose data
   use materially changed across the intervening notices advance, and an
   advancing Review Analysis epoch erases the retired derivatives and replays the
   history, exactly as a manual re-consent did. Saved AI drafts survive a renewal
   that leaves the reply drafting epoch, its runtime profile and the deployment
   profile unchanged (publication binds the drafting epoch, not the state
   version); otherwise the existing withdrawal applies.
5. **Skipped, never forced.** A suspended Organization, an inactive Google
   connection, a Property no live AccountAdmin can manage, a concurrent change or
   a lock timeout skips the Property without a write; the next run tries again.
   A Property left on a lapsed notice reads "Paused — needs attention" with the
   reason, on its AI page and on the AI overview, and its setup step is not done.
6. **Announced after the fact.** Every notice has a plain-language announcement
   in `src/shared/merchant-ai-notice-announcements.ts`; a test fails when the
   served notice has none. AccountAdmins of an Organization whose Properties were
   renewed automatically see a banner until they open "What changed" or press
   "Got it", which records a per-person receipt
   (`merchant_ai_notice_update_receipts`): seen, not consent. The AI overview
   keeps a dated line. The banner does not depend on product-update preferences.
7. **Documents.** Privacy Notice 3.1 (sections 1 and 9), Google Business Profile
   Access Disclosure 2.2 and Closed Beta Participation Agreement 2.2 say this.
   The Privacy Notice's 14-day email rule no longer applies to merchant AI
   notices, with one exception kept on purpose: a newly named AI provider
   receives no Google review before the 14th day after Participants are told by
   email.

## Shipping a new notice

The sweep renews only Properties with an enabled capability whose notice has
lapsed; notices in force are listed per capability (ADR 0074, "Drafting-only
notice activation"). Between the web deploy and the worker's first sweep, work
for a lapsed capability is refused. Under a notice that changes review analysis,
a review event handled in those minutes settles as not analysable and is analysed
again only when the Review Analysis epoch advances. A notice that leaves review
analysis unchanged lists the earlier notice as still in force for it, so analysis
carries on through those minutes, and stored per-review analyses stay delivered
after the renewal: delivery applies the per-capability material-change rule that
settlement uses (`ai-analysis-notice-coverage.ts`). Each new notice also needs its
announcement entry.

## What this changes in ADR 0074

ADR 0074 still holds: the compatibility catalogue, the fences, material changes
choosing which epochs advance, and a new notice whenever data use changes. Its
sentence that a new notice also needs "explicit acknowledgement" now applies only
to capabilities a Property does not already have on. For capabilities already
on, the standing opt-in carries over.

## Consequences

- No consent pause across notice changes beyond the minutes between a deploy and
  the worker's first sweep.
- The evidence names who stood behind each renewal and shows it was automatic
  (reason, run ceremony id); it never claims an acknowledgement of the new text.
- The owner no longer needs a per-notice waiver in `docs/BETA.md`; the waiver of
  2026-10-29 stays as history.
- A future Organization the owner does not own opts in under these documents, so
  the same rule binds it; the new-provider exception covers GDPR Article 28(2)'s
  prior information about a new sub-processor, with turning AI off as the way to
  object.
