# Beta feedback reporting — design and plan

**Status:** Phases 1–2 delivered; Phase 3 awaiting an owner decision
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

7. **`pnpm ops feedback-issue`** — for a triaged report, create a GitHub issue via
   `gh` with a content-free body, then write the issue ref back through the
   existing `transition()` CAS path into `engineering_issue_ref`. Labels derive
   from triage: `bug`/`enhancement` + `needs-triage` + severity.
8. **`pnpm ops feedback-sync`** — read linked issue states via `gh` and advance
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

## 5. Decisions — resolved on 2026-09-18

The owner said to go ahead with all four.

1. **Masked layout capture — built.** The canary was reconciled by the shape,
   not by loosening it: the old screenshot, replay and attachment keys are still
   refused, and the new `maskedLayout` field is geometry only (at most 240
   rectangles, closed role vocabulary). The canary proves every way of smuggling
   a marker through it is refused. It stays first-party rather than going to
   monitoring, because the feedback path deliberately clears attachment state
   and `scrubSentryEvent` deletes attachments. Consent is per submission, with a
   preview and Remove; a CHECK caps expiry at 30 days after capture and the
   retention sweep deletes on it.
2. **Reporter-visible issue links — built.** A plain issue number links to the
   public tracker; anything else stays text.
3. **Notify the reporter — built, but not in the bell.** See the open decision
   below.
4. **BETA.md capability counts — corrected** (they were stale before this work).

### Still open

- **Should report outcomes reach the notification bell?** It cannot today
  without changing a notification-system invariant. Every non-mandatory
  notification is Property-scoped and the database enforces it
  (`notifications_mandatory_scope_check`); the only Organization-scoped
  category, `mandatory`, forces an immediate email that cannot be disabled. A
  beta report has no Property. The reporter is told instead by a marker on the
  Feedback entry point and New rows in their list. Moving it to the bell means
  admitting an Organization-scoped `workflow_collaboration` notice: relax that
  CHECK and its email-queue twin, derive scope per type rather than per category
  in `notificationScopeForType`, resolve channels from ADR 0046's versioned
  defaults when there is no Property preference row, and emit an
  `identity.beta_feedback.resolved` fact when a report resolves. That is the
  notification system's decision, so it was not made here.
- **Privacy notice wording.** The accepted notice's retention table says of the
  optional masked Bug layout that "provider deletion still needs live proof".
  The implementation never sends the layout to a provider, so the caveat no
  longer applies. The notice is still accurate as an upper bound; tightening it
  is a notice change and was left to the owner.

## 6. Verification — what actually ran

| Check                              | Result                                         |
| ---------------------------------- | ---------------------------------------------- |
| `pnpm typecheck`                   | clean (app + scripts projects)                 |
| `pnpm lint` + `check-test-quality` | clean, including the product-state ledger gate |
| Fallow `audit` (changed files)     | clean                                          |
| Unit (`--project=unit`)            | 1,020 files, 9,907 passed                      |
| Storybook (`--project=storybook`)  | 110 files, 920 passed, twice in a row          |
| Integration (triage + retention)   | 19 passed, against real PostgreSQL             |
| `check:schema-drift`               | clean                                          |
| `pnpm build` + `check:bundles`     | initial closure 328,796 B / 329,105 B gzip     |

Specific evidence worth naming:

- The privacy canary refuses every synthetic marker as a recorded-error
  reference and every way of smuggling one through a masked layout.
- The capture walk's test stub throws on any element property besides tag,
  rectangle and visibility, so "reads no content" is enforced.
- The database refuses a layout that would outlive 30 days, and one on a
  suggestion; prose too long for `char(32)` dies on the type before the CHECK.
- `beta-feedback-issue.test.ts` pins that no pseudonym or reporter text can
  reach a public issue, and that the issue names a command that exists.
- **Live run:** a seeded accepted report became issue #591, linked back as
  append-only evidence; closing it let `feedback-sync` resolve the report, and a
  second sync was a no-op. `feedback-layout` rendered a seeded layout with no
  text, image, link or script element. #591 is closed with a note.
- **Bundle budget:** the first cut of the notification marker went 57 B over.
  The closure counts all CSS and Tailwind emits one global stylesheet, so
  one-off utilities in lazy components still landed in it — 25 new rules. They
  are now design-system tokens and existing classes; the CSS is byte-identical to
  main and the closure has 309 B of headroom where it had 68.
- Browser: the dialog at 1440 and 375, dark and light; the masked layout
  captured from a real page and rendered as a wireframe.
