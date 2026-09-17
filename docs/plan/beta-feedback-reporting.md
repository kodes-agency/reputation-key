# Beta feedback reporting — design and plan

**Status:** In progress
**Date:** 2026-09-18
**Branch:** `feat/beta-feedback-reporting`
**Authority consulted:** `docs/BETA.md` §3 (Analytics and feedback), §4 (Capability
authority), `docs/legal/privacy-notice.md` §5 processor table + §6 retention posture,
`src/shared/architecture/privacy-exfiltration-canary.test.ts`.

## 1. What already exists

Beta feedback is **not** greenfield. The subsystem shipped with a strict privacy
posture and most of the hard governance is already built:

| Piece                        | Where                                                           |
| ---------------------------- | --------------------------------------------------------------- |
| Input contract (`.strict()`) | `src/shared/beta-feedback-contract.ts`                          |
| Submit server function       | `src/contexts/identity/server/beta-feedback.ts`                 |
| Sentry delivery seam         | `src/contexts/identity/server/beta-feedback-delivery.server.ts` |
| Content-free triage tables   | `src/shared/db/schema/beta-feedback-triage.schema.ts`           |
| Triage state machine         | `src/contexts/identity/domain/betaFeedbackTriage.ts`            |
| Operator triage CLI          | `scripts/ops/triage-beta-feedback.ts`                           |
| Reporter UI                  | `src/components/features/beta-feedback/`                        |

**Sentry is already connected.** Report text goes to Sentry via
`captureObservabilityFeedback`; Postgres keeps a deliberately content-free triage
row keyed by an opaque `reference`. `beta_feedback_triage.engineering_issue_ref`
already exists as the seam for an issue tracker link — it is simply never populated.

**GitHub is not connected**, and `kodes-agency/reputation-key` is the repo's
issue tracker (`docs/agents/issue-tracker.md`).

## 2. The governing constraint, stated plainly

`kodes-agency/reputation-key` is a **PUBLIC** repository (`gh repo view`), and
GitHub is **not** in the accepted processor table
(`docs/legal/privacy-notice.md:126-132` lists Railway, OpenAI, Google, Sentry).

Therefore reporter free text must never reach a GitHub issue automatically. Two
independent reasons, either sufficient on its own:

1. **Privacy notice.** Adding GitHub as a destination for reporter-submitted
   content is a new processor and a new international transfer. `docs/BETA.md` §2
   commits to 14-day advance notice of material notice changes. That is an
   owner/counsel decision, not an implementation detail.
2. **Public repo.** Report text is unstructured and may contain guest names,
   review excerpts, org identifiers or the reporter's own identity. Publishing
   it is irreversible.

This is not a blocker for the feature — it decides the architecture.

### Data fate per destination

| Destination                 | Carries                                                                    |
| --------------------------- | -------------------------------------------------------------------------- |
| **Sentry** (accepted, US)   | Report free text + controlled diagnostic tags. Unchanged.                  |
| **Postgres** (first-party)  | Content-free triage row: pseudonyms, enums, provider link, state evidence. |
| **GitHub** (public tracker) | Content-free metadata **written by an operator**, never by the reporter.   |

The GitHub issue body carries: the opaque `reference`, type, impact, route key,
viewport, reporter role, severity, and a Sentry deep link. It deliberately omits
the organization and actor pseudonyms — those are stable HMACs and on a public
repo would become a cross-issue correlation handle.

## 3. Defects found while reading

Two real bugs, both fixed here.

### 3.1 A manager who cannot use Portal cannot report a bug (CRITICAL)

`submitBetaFeedbackHandler` gates on `requireExecutionAllowed({ action: 'feedback.respond' })`.
`feedback.respond` maps to capability `portal.guest_response`
(`capability-for-permission.ts:80`), which is `controlled_beta`
(`capability-fate.ts:125`) — off until an Organization policy enables it.

So beta feedback submission is gated behind an unrelated, off-by-default Portal
capability. A manager whose org has no Portal policy cannot report anything —
including the fact that Portal does not work for them. The feedback channel fails
exactly when it is most needed.

**Fix:** a dedicated `feedback.beta_report` permission mapped to a new
`feedback.beta_report` capability with fate `core`, so reporting is always
available to every interactive role.

### 3.2 The impact vocabulary is modelled but never captured

The DB CHECK, the domain schema and the Sentry tag all accept six impact codes
(`cannot_complete`, `workaround_available`, `small_issue`, `important`,
`helpful`, `nice_to_have`). The form asks for none of them and hardcodes
`bug → small_issue`, `suggestion → helpful`
(`beta-feedback.ts:66`, `beta-feedback-delivery.server.ts:36`).

Every bug therefore arrives as the lowest bug severity, and every suggestion as
the middle one. Triage cannot prioritize, which is the whole point of triage.

**Fix:** ask. One tap, no schema migration, no new data class — the vocabulary
already exists end to end.

## 4. What gets built

### Phase 1 — Reporter experience

The current form is a `<Select>` with two options and a bare textarea. Changes:

1. **Type as two choice cards**, not a dropdown. Bug and Suggestion stay the only
   two types — `docs/BETA.md` §3 says "Beta Feedback accepts Bug and Suggestion"
   and the DB CHECK enforces it. "Report an error" is not a third type; it is a
   Bug with an attached Sentry event (item 4).
2. **Impact, asked once, worded for humans.** Three options per type, mapped onto
   the existing six codes.
3. **Guided prompts for bugs** — "What were you doing?", "What happened?", "What
   did you expect?" — composed client-side into the single existing `message`
   field. No contract change; dramatically more actionable reports.
4. **Attach the error RepKey recorded.** When the browser Sentry SDK captured an
   event this session, offer to link it. An event id is opaque hex, not content.
   New nullable `clientErrorEventId` on the input contract, regex-pinned
   `^[a-f0-9]{32}$`, and a matching nullable column on the triage table. This is
   the "report an error" path, and it is what makes a bug report reproducible.
5. **Close the loop — "Your reports".** Reporters currently receive an opaque
   reference and then silence. A list of their own reports with live triage state
   (Received → Screened → Investigating → Accepted/Declined → Resolved) and, once
   linked, the tracked issue number. All first-party, scoped by `actorPseudonym`.
   This is the single change most likely to keep people reporting.
6. **Draft safety and keyboard.** A half-written report survives an accidental
   dialog close (in-memory for the session, never persisted). `Cmd/Ctrl+Enter` sends.

### Phase 2 — The GitHub bridge (operator-mediated)

7. **`pnpm ops:feedback-issue`** — for a triaged report, create a GitHub issue via
   `gh` with a content-free body, then write the issue ref back through the
   existing `transition()` CAS path into `engineering_issue_ref`. Labels derive
   from triage: `bug`/`enhancement` + `needs-triage` + severity.
8. **`pnpm ops:feedback-sync`** — read linked issue states via `gh` and advance
   resolved reports. Operator-run, not an inbound webhook: no new ingress, no new
   auth surface, far smaller blast radius for a beta.

### Phase 3 — Deferred, needs an owner decision

9. **Masked layout capture (`masked_layout_v1`).** Already accepted in
   `docs/BETA.md` §3 ("media needs explicit per-submission consent with preview and
   removal, and is retained no more than 30 days") and in the privacy notice
   retention table ("Optional masked Bug layout — no later than 30 days"). The DB
   already models the attachment kind, the bug-only rule and the 30-day expiry
   CHECK. It is **not** built here: `privacy-exfiltration-canary.test.ts` currently
   asserts that pixel/replay/attachment material is rejected outright, and
   reconciling an accepted-but-unbuilt media path with that canary is a privacy
   decision the accountable owner should make explicitly rather than one I take
   while they are away.

## 5. Decisions for the owner

1. **Masked layout capture** (Phase 3) — accepted policy, unbuilt, blocked on
   reconciling the canary. Build it?
2. **Reporter-visible issue links.** The repo is public, so a tracked issue number
   is a real, clickable link for the reporter. Confirmed desirable? Phase 1 ships
   the number; making it a hyperlink is a one-line change.
3. **Should a resolved report notify the reporter?** The loop currently closes only
   when they reopen the panel. Notification infrastructure exists (`notification.in_app`
   is `core`).
4. **BETA.md §4 capability counts** change (37 → 38, core 12 → 13) because of the
   §3.1 fix. Updated here as a descriptive correction; flagging it because BETA.md
   is the authority document.

## 6. Verification

- Unit: contract parsing, impact mapping, message composition, triage transitions.
- Canary: `privacy-exfiltration-canary.test.ts` extended to prove the new
  `clientErrorEventId` field rejects anything that is not an opaque event id.
- Integration: triage repository round-trip for the new column.
- Browser: the dialog at 320/768/1440, keyboard path, reduced motion.
- Stories beside the components, per `src/components/CONTEXT.md`.
