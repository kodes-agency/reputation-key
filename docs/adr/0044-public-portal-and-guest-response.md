---
status: accepted
date: 2026-07-15
---

# 0044 — Public Portal and Guest Response Policy

## Context

The existing public portal creates guest sessions client-side, accepts unsigned cookies, trusts raw `X-Forwarded-For`, records scans on page mount (inflated by refresh/bots), and allows review-link visibility to drift toward conditional feedback logic (review gating).

## Decision

The public portal is a **review-link touchpoint first**. Private rating/feedback is optional, separately controlled, and must never steer, gate, hide, reorder, or emphasize the review link.

### Independent capabilities

`public_portal`, `private_response`, `free_text`, `guest_contact`, `guest_media` are independently governed. An independently governed capability is not necessarily promotable: `guest_contact` and `guest_media` are beta-blocked until their separate activation evidence is accepted.

### Token and session

1. Public URL uses a high-entropy random token; store a keyed hash, not the raw token.
2. Token rotation supports a grace period for printed codes and explicit revocation.
3. Sessions are server-issued, signed, `Secure`, `HttpOnly`, appropriately scoped `SameSite`.
4. Client-side session creation is removed.

### Anti-gating rule

Review destination visibility, ordering, wording, and prominence are **invariant** across guest response values and states. This is enforced by architectural test:
`src/components/features/guest/public-portal/guest-page-view.test.ts` renders the guest page for ratings 1–5, with and without the private-note card, and in the note-writing, done, withdrawn-note and correcting states, in English and Bulgarian. It does so on both paths a guest can reach: a controlled preview state, and the live public container that binds the response session (`PublicPortalContent`). It requires the Google card to have the same markup, position, heading, copy and accessible name every time, on every path.

The Immersive Hub (snapshot schema version 3) has its own response view, and `src/components/features/guest/public-portal/immersive/immersive-response.test.ts` holds it to the same rule on its own markup. It renders the receipt strip, the Google card and the note card for ratings 1–5 in every guest language (the catalogue's six, so the suite follows the catalogue when a language is added), and requires the Google card to be identical and second at every rating, whether or not the note is offered, and the Google-unavailable card to take the same place. The view takes no rating comparison: the note appears only when the server sets `privateFeedbackEligible`, and the test pins that the view follows that flag (it shows the note card when the flag is set and hides it when it is not). The inclusive threshold boundary itself belongs to the server rule and is held by `src/contexts/guest/application/use-cases/guest-response-lifecycle.test.ts`.

The Immersive Hub's "Your response" section (change the rating, remove the note, remove the rating and note, start over on a shared device) is the last card of that page and carries the same rule: `src/components/features/guest/public-portal/immersive/immersive-response-section.test.ts` requires its markup to be identical at ratings 1–5, with and without the note offered. It lists the guest's own controls and their server-set deadlines, written in the portal's time zone with a `now` that travels with the page data, and it never compares the rating with anything (the rating form only starts on the guest's current star). Removing the rating and the note is the one action that cannot be undone, so its button asks first ("Remove both" or "Keep them") and sends nothing until the guest confirms.

### Abuse and privacy

1. Layered limits by portal, session, network signal, organization, and operation.
2. Idempotency keys for submit and correction; duplicates return existing result.
3. Public edge fails closed for submissions/uploads if the limiter/session dependency is unavailable. The static review-link page may remain available through a separate read path.
4. No arbitrary redirects; only allowlisted HTTPS provider URLs.

## Consequences

- Client-generated session cookies are removed.
- Raw `X-Forwarded-For` is replaced by trusted-proxy chain handling.
- Scan recording moves server-side with bot/link-preview filtering.
- Guest rating and feedback submit as one aggregate, not independent partial records.
- Cookie notice must not claim anonymity when session identifiers, network signals, or free text are stored.

## Rejected Alternatives

- **Client-side session** — guest can rotate identity and evade per-session controls; cookie is not trustworthy.
- **Rating-conditioned review link visibility** — prohibited review gating.

## Amendment 2026-10-01 — sealed address (ADR 0064)

"Token and session" decision 1 ("store a keyed hash, not the raw token") is
amended by [ADR 0064](0064-sealed-portal-address-and-download-again.md). Public
resolution still reads only the keyed hash. When a keyring is configured, the
raw address of an active code is also stored sealed (AES-256-GCM, bound to its
tenant, Portal, token and version) so a manager can download the code again;
every disclosure is recorded before it happens, and no other path reads the
sealed copy. Without a keyring this ADR's behaviour is unchanged.

## Amendment 2026-10-01 — the Linktree is visible from arrival

Owner decision 2026-09-30: on the Immersive Hub guest page (snapshot schema version 3) the
Linktree is visible from arrival and in every state after it, not only after the guest has rated.

The rating card stays first and dominant: it comes before the Linktree in the page, it is the
larger and more prominent surface, and the Linktree never competes with it. This changes
when the secondary links appear, and nothing else in this record:

- The anti-gating rule above is untouched. The Google Review Action is still shown only after a
  rating, identical for ratings 1–5, and nothing in the Linktree can steer, hide or reorder it.
- A tap on a link before any rating is navigation only. The tile is a plain link to the
  navigation-only click route, which resolves the destination and redirects without recording
  anything, so it is not a Qualified Link Action and never reaches product analytics. The
  origin-, CSRF- and session-bound mutation that records one still requires a rated session
  and is not called before a rating.
- Snapshots of schema versions 1 and 2 keep the legacy renderer, where the destinations still
  appear after the rating. The rule is pinned for them until they are republished.
- The amendment is guest-visible on a portal only when a version 3 snapshot is published for it
  (slice 19 of the round-4 plan).

## Amendment 2026-10-01 — the visit notice is one line

Owner decision (round-4 owner questions 1 and 3): on the Immersive Hub guest page the footer
shows one line in every language pack, "{name} counts visits with one essential cookie and a
privacy-protected marker. No ads or third-party trackers." It replaces the longer text that
separated the essential session cookie from the short-lived network marker.

- The Consequences rule above is unchanged: the line names the essential cookie and the
  privacy-protected marker and does not claim anonymity. Each language pack carries a
  translation that names both and the absence of ads and third-party trackers, held by
  `guest-copy-v2.test.ts`.
- Visit recording stays independent of the acknowledgement. The notice is informational.
- The privacy link stays the English `/privacy` page for the closed beta.
- The printed QR kit shows only the host under the code. The token path is the code's own
  secret, and the code and the NFC tag already carry it.

## Amendment 2026-10-09 — the guest page review

Findings of the portal UI/UX review of 2026-10-08, on the Immersive Hub guest page. Two of
them touch decisions in this record.

- **Start over after a removal.** "Your response" offers "Start over" on a shared device, and the
  server refused it for any session that did not hold a durable rating. A guest who removed their
  whole response was left with a notice and nothing to press, and a reload showed the same
  notice for the rest of the 24 hours: a session takes one response, so the removed one ends
  that session's chance to rate. The server now also issues the fresh session to a session whose
  response the guest withdrew (`canStartNewGuestResponse`). Nothing else widens: Google and
  link actions still need a rating, a session with no response has nothing to start over from,
  and the fresh session is rate limited and pressure counted on the same keys as the one
  after a rating. What was withdrawn is gone and its facts were retracted, so the cycle adds
  no reading, and a visit counts once per signed session as it always did. The removed notice
  carries the shared-device block, and the fresh page says "Ready for the next guest." without
  claiming an earlier response remains saved.
- **The privacy link.** It stays the English closed-beta `/privacy` page (previous amendment).
  On a page in any other language the link now says so in that language ("Datenschutzhinweis
  (auf Englisch)"), and it opens in a tab of its own so a guest part-way through a rating keeps
  their place. Translated, natively checked notices remain an owner question for general
  availability.

The page a guest sees when there is no portal (a bad or rotated address, an unpublished portal, a
suspended property, a denied capability, or a server that could not answer) is in the language
the visitor's browser asks for (`Accept-Language`), English when it asks for none of the six,
with the English words under a rule when the first language is not English, and a "Try again"
button for every cause. The browser's preference says nothing about the portal, so the page
still reveals nothing about why it is not there.
