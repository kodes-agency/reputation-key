# Beta feedback → Sentry → GitHub

How a report travels, and what each destination is allowed to hold.

## The three destinations

| Destination                              | Holds                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| **Sentry** (accepted processor)          | The reporter's words, plus controlled diagnostic tags.                     |
| **Postgres** `beta_feedback_triage`      | Content-free: pseudonyms, closed enums, provider linkage, state evidence.  |
| **GitHub** `kodes-agency/reputation-key` | Controlled triage vocabulary and monitoring links. Written by an operator. |

## Why GitHub never carries the report text

Two independent reasons, either sufficient on its own.

1. **GitHub is not a listed processor.** The accepted privacy notice names
   Railway, OpenAI, Google and Sentry (`docs/legal/privacy-notice.md` §5).
   Routing reporter-submitted content to GitHub is a new processor and a new
   international transfer; `docs/BETA.md` §2 commits to 14 days' advance notice
   of material notice changes. That is an owner decision, not an implementation
   detail.
2. **The repository is public.** Report text is unstructured and may contain
   guest names, review excerpts, organization identifiers, or the reporter's own
   identity. Publishing it cannot be undone.

The organization and actor pseudonyms are withheld too. They are stable HMACs,
so on a public tracker they would become a durable handle for correlating every
report from one organization or one person — the thing pseudonymising them was
meant to prevent.

`src/contexts/identity/application/beta-feedback-issue.ts` is the only place an
issue body is built, and its tests pin both rules.

## The operator path

```bash
# 1. See the queue.
pnpm ops triage-beta-feedback --operator <id>

# 2. Classify and accept. Fourteen positionals; see that command's usage.
pnpm ops triage-beta-feedback <reference> <revision> accepted <severity> \
  <privacy> <security> <reproduction> <dedupe> none engineering <owner-id> \
  pending none <transition-uuid> --operator <id> --ticket <ref> --apply

# 3. Preview the issue. Without --apply nothing is created.
pnpm ops feedback-issue <reference> --operator <id> --ticket <ref>

# 4. Create it and link the number back into engineering_issue_ref.
pnpm ops feedback-issue <reference> --operator <id> --ticket <ref> --apply

# 5. After the issue is closed on GitHub, resolve the reports it settled.
pnpm ops feedback-sync --operator <id> --ticket <ref> --apply

# Render a report's consented masked layout to a local SVG (read only).
pnpm ops feedback-layout <reference> [out.svg] --operator <id>
```

All three were run end to end on 2026-09-18 against a disposable local database:
a seeded accepted report became issue
[#591](https://github.com/kodes-agency/reputation-key/issues/591) with the number
written back as append-only transition evidence; closing #591 let `feedback-sync`
resolve the report, and a second sync found nothing to do. #591 is closed with a
note saying it was a verification, not a report.

Step 3 always runs first: the preview prints the exact title, body and labels
that would be published, so what leaves is read before it leaves.

`SENTRY_ORG_SLUG` turns the monitoring ids in the issue body into links. Without
it they render as bare text rather than as a guessed URL.

## Why sync is a pull, not a webhook

An inbound GitHub webhook would mean new public ingress, a shared secret and a
signature-verification surface — for a beta whose entire feedback volume one
person reads. `ops feedback-sync` asks `gh` about the issues already linked to
accepted reports and resolves the ones GitHub reports closed. It reads issue
state only, never a body or a comment.

## What the reporter sees

The launcher's second panel lists that reporter's own reports and how far each
has travelled: Sending, Not sent, Received, Read, Being investigated, Accepted,
Not planned, Resolved. Severity, privacy class, security class, owner queue and
dedupe disposition never cross back —
`src/components/features/beta-feedback/beta-feedback-status.ts` owns that
mapping and a test pins that the internal vocabulary does not leak.

## The masked layout, and why it is not in monitoring

A Bug may carry a `masked_layout_v1` picture of the page after the reporter
consents to it on that submission, sees the preview, and keeps it. It is
geometry only: a viewport size and at most 240 rectangles, each with a role from
a closed vocabulary. The capture walk reads an element's tag, rectangle and
visibility and nothing else; its test stub throws on any other property read.

It does not go to monitoring. The feedback path deliberately clears both Sentry
scopes so attachment state cannot hitchhike, and `scrubSentryEvent` deletes
`attachments`; opening a channel would weaken both. It lives in
`beta_feedback_masked_layouts`, committed with its triage row, and expires under
a database CHECK no later than 30 days after capture. `feedback-layout` is how a
triager looks at it.

## Telling the reporter

In the notification bell, and by a marker on the Feedback entry point (ADR 0059).
When `ops triage-beta-feedback` or `ops feedback-sync` moves a report into
accepted, not planned or resolved, Identity recomputes the reporter's pseudonyms
over its own Organization and member rows. It writes
`identity.beta_feedback.outcome_reached` in the same transaction. The feed turns
that into an in-app `beta_feedback.outcome` notice, which is never mailed, and
whose link opens "Your reports". A reporter who has left the Organization is
not matched and gets no notice; both commands report `reporterNotified` so the
operator can see it.
