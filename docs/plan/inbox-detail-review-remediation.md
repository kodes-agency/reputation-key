# Inbox detail pane — review remediation plan

Scope reviewed: `git diff 7ab5d67bf...cc095eb66`, the tip of `ux/inbox-detail`
at review time, which reached main squashed as #569 (2bf00753e) — 183 files,
+33,005 / −3,207, the v1 + v2.1 inbox detail-pane rebuild. File and line
references in the findings below point into cc095eb66.

Class names are written out in words throughout. Tailwind scans `docs/`, so a
utility spelled out here is compiled into the stylesheet the bundle budget
measures.

Method: ten parallel review facets (architecture, component design, type safety,
design-system conformance, test quality, security, dead code, silent failures,
performance, comment accuracy). Every finding below was re-verified against the
code before entering this plan; agent claims that did not survive verification
were dropped and are listed at the end.

## Baseline — the repo's own gates were already green

| Gate                                                                                                        | Result |
| ----------------------------------------------------------------------------------------------------------- | ------ |
| `pnpm typecheck`                                                                                            | pass   |
| `pnpm lint` (eslint + architecture-boundary + filenames + component-boundaries + product-state-consistency) | pass   |
| `pnpm test:unit`                                                                                            | pass   |
| `pnpm test:integration`                                                                                     | pass   |

No component exceeds the 300 counted-line limit, no component value-imports from
`contexts/*/server` outside the allowlist, all filenames are kebab-case. The
governance changes in this diff are disciplined: the boundary allowlist was
_moved_ (`reply-form.tsx` → `use-reply-actions.ts`), not widened; `CONTEXT.md`
was amended to legitimise the hook-owns-mutations pattern; and every new
`useState` is documented in the product-state ledger.

**The defects below are all things the gates cannot see.**

---

## P0 — Correctness, user-visible

### P0-1 Composer is permanently bricked by typing during AI generation

`use-reply-suggestion.ts:148-150`

```ts
} finally {
  if (requestSequence === sequence.current) setIsGenerating(false)
}
```

`dismiss()` (`:157`) does `sequence.current += 1`. `updateDraft`
(`use-reply-composer.ts:207`) calls `ai.dismiss()`, and `updateText` (`:308`)
calls `updateDraft` — so **every keystroke bumps the sequence**. The textarea is
deliberately _not_ disabled during generation (`reply-editor-compose.tsx:223`
lists `isSaving || isAdopting || templates.isLoading` and omits `isGenerating`).

Press _Draft with AI_, type one character before the response lands: the
in-flight `finally` no longer matches, `setIsGenerating(false)` never runs, and
`isGenerating` stays `true` for the life of the mount. `busy`
(`reply-editor-compose.tsx:132`) then disables every assist control, and
`canSubmit` (`use-reply-composer.ts:301`) includes `!ai.isGenerating`, so
**Submit is disabled forever**. The only escape is navigating to another item.

_Fix:_ clear the flag when _this_ call owns it rather than when it is still the
newest. A superseding `request` re-sets `isGenerating` to `true` itself, so an
owner-scoped unconditional clear is safe. Add a regression test.

### P0-2 No inbox mutation has any user-visible failure path

`use-action-mutation.ts:77-79`, `use-reply-actions.ts:25-44`,
`inbox-case-toolbar-props.ts:244-253`

`useActionMutation`'s `onError` does only `context?.undo?.()`; `toast.success`
fires on success and there is no `toast.error` anywhere in
`src/components/inbox` or `src/components/hooks`. `router.tsx` defines no
`MutationCache` and no global `onError`. `ReplyActions` narrows nine mutations to
bare `Promise<unknown>` callbacks, discarding each Action's `.error`;
`InboxCaseToolbarProps` narrows assign/escalate/resolve to `() => void`.

So a refused **Confirm & Publish**, **Reject**, **Try publishing again**,
**Assign** or **Escalate** is indistinguishable from a click that missed — no
toast, no message, no state change. The comment at
`reply-message-actions.tsx:288-289` justifying `.catch(() => undefined)` with
"the toast already reports it" is **false**. A deliberately written message
(`use-inbox-detail.ts:105-108`, "This item changed again while you were
working.") is a dead branch nothing renders.

_Fix:_ give `useActionMutation` an error channel — `onError` raises
`toast.error(options.errorMessage ?? <default>)` after the rollback, with an
opt-out for mutations that render their own error. This is the single
highest-leverage change in the plan: it closes both P0s' downstream failures at
once. Then delete the false comment and the `.catch(() => undefined)` swallows
it was defending.

### P0-3 A failed notes read renders as "no notes"

`use-inbox-detail.ts:230,234`

`notes: notesQuery.data ?? []`, and `error:` reads only `detailQuery.error`.
`notesQuery.error` is referenced nowhere. A failed read produces `notes: []`,
`isLoading: false`, `error: null` — a case that looks genuinely note-free. The
manager decides without a colleague's note and files a duplicate.

`inbox-thread.tsx:455-463` already does this correctly for history (`isPending`
_and_ `isError` both rendered). Notes get neither.

_Fix:_ fold `notesQuery.isError` into the returned state and render a line under
the rail in the same shape as "Handling history is unavailable right now."

---

## P1 — Errors reported, but about the wrong thing

### P1-1 `submit()` blames the save when the submit failed

`use-reply-composer.ts:276-281` — one `try` wraps both `autosave.flush(draft)`
and `input.onSubmit()`; every rejection sets _"Save the draft successfully before
submitting it."_ When `submitReplyFn` is what refused, the draft saved fine and
the head reads **Saved** while the foot tells the user to save.
_Fix:_ separate `try` blocks, carry the submit rejection's own message.

### P1-2 An autosave failure is reported as an AI failure

`use-reply-suggestion.ts:96,145-148` — `await input.onFlush(input.draft)` sits
inside the generation `try`, so a rejected save prints "The draft suggestion
could not be generated." while the head prints **Not saved**.
_Fix:_ flush outside the `try`, or catch separately and surface the save error.

### P1-3 A post-load save failure is reported as a load failure

`use-reply-template.ts:249-263` — `onAccept` (the autosave flush) shares the
load `try`. The template _did_ load and the server draft _was_ patched
(`use-reply-actions.ts:98-100` → `inbox-cache-policy.ts:140-148`), but the throw
skips `onAdopt`, so the client keeps the old text. The user is told the load
failed and the two surfaces silently diverge.
_Fix:_ move `onAccept` out of the load `try`, give it its own message, adopt
locally before attempting the save.

### P1-4 Autosave `dispose()` discards pending work silently

`reply-autosave-coordinator.ts:149-153` — `listener = null; cancelTimer();
pending = null`. Any unmount inside the 700 ms debounce that does not fire
`focusout` loses the draft _and_ emits nothing, because the listener is already
detached. The Reply/Note tab case was fixed by force-mounting both panels
(`reply-composer.tsx:681-695`), but that fix is local to the tab switch;
removing a focused textarea from the DOM does not dispatch `focusout`.
_Fix as first proposed, and wrong:_ stop nulling `pending` in `dispose()` — a
debounced snapshot never lives in `pending`, so it rescued nothing. See Outcome
for what landed.

### P1-5 `schedule()` clears the error state without clearing `failed`

`reply-autosave-coordinator.ts:105-115` — emits `unsaved`/`pending`/`saved`
unconditionally and never touches `failed`, while `reply-composer-footer.tsx:66`
renders **Retry save** only on `status === 'error'`. Clearing the box or
switching to auto-detect repaints the head to a plain _Not saved_, removes
**Retry save**, and strands the unsaved snapshot with no route back.
_Re-judged — see Outcome._ Both proposed fixes turned out wrong: the sticky
branch never fired for the language switch, and clearing `failed` in `schedule`
is what let Submit skip a save.

### P1-6 An unrecognised reply status makes the reply vanish

`reply-status-view.tsx:58-75` → `{ kind: 'none' }`, which
`reply-message-view.ts:96-99` maps to `null` alongside `'compose'`, and
`inbox-detail-content.tsx` gates the composer on `kind === 'compose'`. The pane
then shows neither the reply nor a compose box. `history-event-line.ts:113-118`
documents that exactly this version skew is reachable without a client deploy.
_Fix:_ give `'none'` a rendered arm rather than sharing `'compose'`'s silence.

---

## P2 — Accessibility (the repo's own written rules, applied unevenly)

### P2-1 The region's primary is natively disabled while carrying the only reason

`reply-composer-footer.tsx:105-109` — `disabled={!canSubmit || disabled}` plus
`aria-describedby={submitBlockedReasonId}`. A natively disabled button leaves the
tab order and takes its description with it. The sibling
`reply-message-actions.tsx:201-207` documents and implements the correct pattern
(`aria-disabled` + `aria-disabled:opacity-50` + `preventDefault`).
Compounding: the reason `<p>` at `:118-122` is _also_ a conditionally mounted
live region, so **neither** route reaches the user. Same defect at
`reply-ai-menu.tsx:104-118` and `reply-template-menu.tsx:180-194`.

### P2-2 Four of five live regions are mounted with their first message

Broken: `reply-editor-compose.tsx:207`, `reply-suggestion-controls.tsx:106`,
`inbox-thread.tsx:459`, `reply-composer-footer.tsx:118`.
Correct model: `inbox-thread.tsx:285` (node always mounted, content conditional).
The repo states this rule in four separate comments
(`reply-message-actions.tsx:157-160`, `reply-editor-views.tsx:244-250`,
`inbox-thread.tsx:242-249`, `composer-mode-row.tsx:400-406`) and then breaks it.

### P2-3 Focus is dropped to `<body>` by the reject panel

`reply-message-actions.tsx:269-306` — Cancel and Confirm Reject each unmount the
focused element. `inbox-thread.tsx:189-194` states this repo's rule for exactly
this case. _Fix:_ return focus to the still-mounted Reject trigger.

### P2-4 The thread scroller can have zero focusable descendants

`inbox-detail-content.tsx:386` — a bare `overflow-y-auto` div with no `tabIndex`
and no role. A review with no disclosure, no drawn events, no notes and no reply
is unscrollable by keyboard (axe `scrollable-region-focusable`, serious).
_Fix:_ `tabIndex={0}` + `role="region"` + a name — which also fixes P2-5.

### P2-5 Two of the pane's four regions carry no landmark or name

`inbox-case-toolbar.tsx:440` renders `<section aria-label="Case status">`; the
thread scroller and the composer region are bare divs.

---

## P3 — Architecture

### P3-1 Provider reply text is served through one governed and one ungoverned path

`reply-lookup.adapter.ts:60-63`. `getCurrentGoogleReplyByReviewId` is the
governed read (`eligible-reads.ts` applies `isContentEligibleForRead` plus
content-state/provenance gates). The legacy fallback on `:62` serves
`replies.find(c => c.source === 'google_sync')` straight off `findByReviewId`,
with no eligibility filter. So ADR-0031 retention on provider text depends on
whether an observation row happens to exist — and the un-migrated rows are
exactly the ones taking the ungoverned path.

Worse, `getCurrentGoogleReplyByReviewId` returns a bare `null` for six distinct
outcomes (absent / not live / no provenance / null text / content inactive /
ineligible), so the adapter cannot tell "Google has no reply" from "Google has a
reply we may not serve" and falls through to the legacy branch. A `draft`
internal reply then wins and `resolveReplyView` turns it into `{ kind:
'compose' }` — **re-opening the exact defect this work was written to close**
(a compose box over a reply that is already live on Google).

_Fix:_ return a discriminated outcome (`none | ineligible | available`) and
present `ineligible` as read-only rather than as a compose box.

### P3-2 The detail read is a sequential waterfall

`get-inbox-item-detail.ts:127-178` — after `findDetailById`, four _independent_
awaits run in series: AI analysis, effective reply, response target, property
reply language. _Fix:_ `Promise.all`. Pure win, no semantic change.

### P3-3 The whole `ReplyRepository` is handed to the Inbox context

`composition.ts:545-547` — `reply: { ...review.lookups.reply, ... }`.
`review.lookups.reply` is typed `ReplyRepository` and built as an object literal
(`createReplyRepository = (...): ReplyRepository => ({...})`), so all methods are
own-enumerable and the spread copies `upsert`, `conditionalUpdate`, `deleteById`
and `deleteByReviewIdAndSource` too. The declared `ReplyLookupSource` narrows the
type, not the object, and a spread does not trigger excess-property checking.
`review/build.ts:637-641` claims "the repositories themselves stay
context-private" — that comment is false.
Pre-existing, but this diff touched the line and the fix is local.
_Fix:_ build an explicit named read-only object.

### P3-4 `ReplyEntityView` has an optional discriminant

`reply-lookup.port.ts:22-23` — `kind?: 'reply'`, so `reply.kind === 'reply'` is
not a valid narrowing and every consumer narrows by exclusion instead.
_Fix:_ make it required and stamp it in the write-through patch.

### P3-5 Over-broad cache invalidation

`query-keys.ts:19-26` — `notes`, `activity` and `history` are all descendants of
`detail(id)`; `history` was **added by this diff**, widening the blast radius.
`settings/ai.tsx:62` invalidates `inboxKeys.details()`, the ancestor of every
detail, notes, activity and history query in the cache, for a settings edit that
changes one derived string. The same file documents this exact lesson for
notifications at `:43-53`.
_Fix:_ make the four siblings under a shared `item(id)` root, and narrow the
settings invalidation.

---

## P4 — Design system

`DESIGN.md` is the binding standard. Conformance is high overall — colour is
fully tokenised (zero hex/rgba in code), depth is tonal with no shadow-for-
elevation and no glassmorphism, motion is 150 ms compositor-only under a global
reduced-motion guard, and the one-accent budget holds. The gaps are structural:

1. **No type-scale tokens exist.** `styles.css`'s `--text-primary/secondary/
tertiary` are _colours_. `@theme inline` tokenises every colour, radius and
   font family and zero font sizes, so DESIGN.md's 15 px Body and 13 px Label are
   unreachable through a utility. Consequence: one thread rail prints prose at
   **five different sizes** (guest 16 / note 14 / reply 14 / event 13 /
   composer 16→15). _Fix:_ tokenise the six steps, then collapse the rail.
2. **Four invented radii** — 10 px on the dock (`reply-composer.tsx:178,198`),
   and 7, 5 and 3 px on the mode segment's track, thumbs and key caps
   (`composer-mode-row.tsx:164,183,224`), against a documented set of
   2/6/8/12/full.
3. **Four focus-ring spellings** — the documented 3 px ring at half opacity
   once, a 2 px ring three times, a 2 px outline once.
4. **Raw `amber-400`** in a `ui/` primitive (`star-rating.tsx:67`) while this
   same diff added the `--warn` family to `styles.css:39-45` precisely to end
   borrowed Tailwind ambers. Theme-blind: the file's own table records 1.13:1
   light vs 5.71:1 dark.
5. **`shadow-xs` as a selection cue** (`reply-template-menu.tsx:108`) — §4 allows
   it only as an ambient hint on inputs and cards, never as elevation.
6. **The standard is stale in two places**: the `--warn` family and the real 4 px
   spacing grid are both good decisions DESIGN.md does not describe.

---

## P5 — Structure and maintainability

1. **`DetailContentProps` is 15 props**, 11 of them copied off `detailState` in
   two verbatim call sites (`inbox-detail-panel.tsx:73-89`,
   `inbox-detail-sheet.tsx:154-170`). Taking `detailState` as one prop deletes
   ~12 duplicated lines across three files.
2. **A 27-prop `{...props}` spread** into two menus
   (`reply-suggestion-controls.tsx:19-28,51-65`) — TypeScript's excess-property
   check does not fire through a spread, so dead and cross-wired props are
   undetectable.
3. **Four levels of prop drilling** for `propertyId` and the three language
   values. The repo already solved the harder version of this once with
   `ComposerSaveStateScope` (`composer-mode-row.tsx:316-338`).
4. **Comment density.** Production files pass the 300 counted-line gate while
   being 460–730 raw lines — `reply-composer.tsx` is 730 raw / 258 counted, i.e.
   65 % comments and blanks. The prose is high quality and often load-bearing,
   but `max-lines` has stopped being a meaningful signal for this feature, and
   comments that cite other files by line number and pin behaviour to commit
   SHAs carry real rot risk.
5. **Duplicated thread markup.** The relative-timestamp `<time>` element and its
   `Date` coercion are written out three times (`note-message.tsx:126,145`,
   `history-event-node.tsx:105,131`, `reply-message.tsx:199`), and
   `MESSAGE_PROSE_CLASS` — the shared measure for every thread body — is exported
   from `guest-message.tsx` and imported by three peers.

---

## Outcome

Branch `ux/inbox-detail-review`, rebased onto main at f30bd4078 (#594). The
reviewed rebuild reached main through #569, and by the time this branch landed,
#578 (6de210a6d) had fixed two of the defects above, and one found later, in its
own way. Where it had, the rebase kept main's mechanism and dropped the review's
own fix; the table says which. This section is the current state. The finding descriptions
above are the record of what was found, as found.

### Status of every finding

| Finding                                     | Status                 | Where it landed, or why not                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1 composer lock                          | Landed                 | `use-reply-suggestion.ts`: a `generatingRequest` ref owns `isGenerating`, and the `catch` reports a thrown failure to that same owner, so a keystroke during generation neither locks the composer nor swallows the failure. Stories `TypingDuringGenerationDoesNotLockTheComposer` and `GenerationFailureAfterTypingIsReported`. A returned refusal that lands after a keystroke is still dropped; see _Left for a product decision_.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| P0-2, reply commands                        | Fixed on main (#578)   | Main's `useActionMutation` has an opt-in `errorMessage`, and `actionErrorMessage` shows the server's own sentence for a 4xx refusal and "Something went wrong. Try again." for anything else. `use-reply-actions.ts` wires it to submit, approve, reject, delete, retry and edit; the check toasts through `replyCheckErrorMessage`. #578 also made the comments beside the `.catch` calls true. This PR changes neither `use-action-mutation.ts` nor `use-reply-actions.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P0-2, toolbar commands                      | Landed                 | Escalate, resolve escalation and assign opt into main's `actionErrorMessage` (`use-inbox-detail.ts`). Both of their callers settle the rejection instead of leaving it unhandled: the toolbar (`buildInboxCaseToolbarProps`) and main's `e` shortcut (`bindEscalationShortcutCommands`). A second revision conflict is thrown as the 409 refusal it is, so its toast reads "This item changed again while you were working. Please try again." and it stays out of Sentry. Reopen (`updateStatus`) has no toast on purpose: the reopen dialog shows the server's reason in its banner, and cannot be dismissed while the command is in flight. Tests: `inbox-case-toolbar-props-refusal.test.ts` and `use-inbox-escalation-shortcut.test.ts` (no unhandled rejection), `inbox-revision-conflict-toast.test.ts` (the conflict sentence is toasted, once). The toast for these commands' other refusals rests on main's tests of the mechanism (`use-action-mutation.test.ts`). |
| P0-3 notes read                             | Landed                 | `notesUnavailable`, true only when there is nothing to show. Story `NotesUnavailable`. Limit: a failure on first load is read in order but not announced as a change, because the thread mounts after the notes read settles.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P1-1 submit blamed the save                 | Fixed on main (#578)   | `submitAfterSave` saves and submits in separate `try` blocks and submits only after a save that went through; a refused submit is toasted by the submit mutation's `errorMessage`. Main still kept a composer sentence of its own for a failed save ("Save the draft successfully before submitting it."), which outlived autosave's error and resurfaced under a head reading `Saved`; this PR removes it, so the line under Submit prints autosave's error and nothing else. Story `SaveFailureBeforeSubmitIsAnnounced` (the failed save is announced, Submit is described by it, and nothing is submitted); unit tests in `reply-composer-transitions.test.ts`.                                                                                                                                                                                                                                                                                                            |
| P1-2 save failure read as an AI failure     | Landed                 | `use-reply-suggestion.ts` flushes in its own `try`. A failed save is reported by autosave ("Draft could not be saved", with `Retry save`), never as "could not be generated". Story `SaveFailureBeforeDraftingIsNotAGenerationFailure`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| P1-3 template load/save                     | Landed                 | Adopt the loaded template before saving; a failed save reports through the autosave channel (`Retry save`), not as a failed load. Because the load writes the server's draft itself, the coordinator forgets its confirmed copy before every load (`invalidate()`), so a load that fails or is dropped after writing cannot let Submit skip a save. That covers a save already in flight when the load starts, such as the flush the Template click's blur sets off: it cannot re-confirm the server's copy when it lands, and a flush of the same text queues behind it rather than joining it (the coordinator's `generation`). Story `TemplateLoadsEvenWhenItsSaveFails`; unit tests in `reply-autosave-coordinator-teardown.test.ts`.                                                                                                                                                                                                                                     |
| P1-4 draft lost on unmount                  | Landed (second design) | `flushOnTeardown()` sends the latest unsaved text from where it sits — the debounce, or the queue behind an in-flight save — chained after the in-flight save and before `dispose()`. A save that already FAILED is deliberately not retried: `failed` is not reliably the box (a token-less `Use draft` saves before the composer adopts it, and a save can fail after Delete draft), and the failure was reported while the composer was open. A retry was built during verification and reverted when review showed it could write an unadopted suggestion, or a deleted reply, back. Unit tests in `reply-autosave-coordinator-teardown.test.ts`.                                                                                                                                                                                                                                                                                                                         |
| P1-5 stranded retry                         | Re-judged              | Overstated. When the text moves on, `Retry save` would re-save text nobody wants, so it disappearing is right. The real hazard underneath — reporting `Saved` for text the server may not hold — is closed by P1-4's companion change: after any failed save the coordinator no longer claims a confirmed copy (`lastSaved = null`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| P1-6 unknown reply status                   | Landed                 | `none` carries the reply and prints it read-only, with no actions, under a neutral "Status unavailable" chip that says nothing about Google. Story `UnknownStatusIsReadOnly`; unit test in `reply-message-view.test.ts`. The inbox row still describes such a reply from its publication fields, as on main.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P2-1 disabled primaries                     | Landed                 | Submit and both assist-menu primaries are `aria-disabled` when blocked with a reason, natively disabled otherwise.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| P2-2 live regions                           | Landed                 | All four are always mounted with their text conditional; the ones that print take no space while silent. The save-failure line under Submit follows the same pattern.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| P2-3 focus return                           | Landed                 | Cancel returns focus to Reject. A successful Confirm Reject moves it to the rejected reply's Edit & resubmit (`ReplyMessage`, through `useReplyFocusReturn`, which the check's focus return now shares). Cancel is disabled with its siblings during a write. Stories `RejectRevealsReasonField` and `RejectingClosesThePanel`. The reopen dialog likewise refuses Escape and outside clicks while its command is in flight, so a refusal always lands in an open dialog.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| P2-4, P2-5 regions                          | Landed                 | `Conversation` (focusable) and `Composer` are named sections. The Conversation section is main's `DetailThreadRegion` in `inbox-detail-regions.tsx`, where #569 moved the thread scroller. The list's arrow-key shortcut yields to anything that owns its arrow keys: a marked scroller (the Conversation section and the suggestion proposal), and menu, select, tab, radio and slider controls. A button whose popup is a dialog (the reply-due chip, Filters, `Review update`) still walks the list. Story `FourNamedRegions`; the feedback-pane stories find region 4 by name; `use-inbox-keyboard-shortcuts-scroll-region.test.ts` has a case for each owner.                                                                                                                                                                                                                                                                                                            |
| P3-1 governed/ungoverned reads              | Open                   | A data decision. The governed read gates on the observation row's `contentExpiresAt`; legacy `replies` rows have no retention field, so the same gate cannot be applied to them. Closing it needs a migration into observations or a ruling that ADR-0031 does not cover them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| P3-2 waterfall                              | Landed                 | The five enrichments run in one `Promise.all`. The field-level scopes (`reply.manage`, the feedback handle permission and its property scope) still run before their own reads.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| P3-3 repository leak                        | Landed                 | Named read methods for both `reply` and `review`. `reply` names four, including `findReviewIdsByReplyStage`, which main's governed queues read (#569).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| P3-4 optional discriminant                  | Open                   | Planned, not done. Type hygiene with no behaviour defect; making `kind` required ripples through the write-through patch types and every reply fixture in the stories, so it belongs in its own change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| P3-5 query keys                             | Landed                 | Item reads are siblings, keyed by aspect and then id, so `details()` reaches only details. The caller the old nesting actually cost was the on-demand analysis poll (`use-on-demand-review-analysis.ts`): it invalidates `detail(id)` every 5 s while it waits for an analysis, and each tick refetched the item's mounted notes and Handling History. The settings save named above now lives in `properties/$propertyId/settings/{profile,replies,ai}.tsx`; no pane is mounted there, so under the old shape it only marked those entries stale.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Cross-item reply cache write (pre-PR round) | Fixed on main (#578)   | A reply command that settled after the manager opened another item wrote into the new item's cache. Main routes the result by the command's own `reviewId` (`InboxReplyCacheChange.reviewId`, `cachedItemIdsForReview`), pinned by `reply-result-routing.test.ts`. The review's own fix and its test were dropped on rebase. This PR only removes the key-length filter `cachedItemIdsForReview` needed while notes and history were nested under a detail.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| P4-1 type scale                             | Open (re-judged)       | A deliberate hierarchy, not drift; changing it is a redesign.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P4-2, P4-3, P4-4                            | Landed                 | Radii on tokens: the dock's 10 px corners take the 12 px token, and the mode segment's 7/5/3 px take the 6 px and 4 px tokens. One focus-ring spelling: the documented 3 px ring at half opacity, partnered by a full-opacity 1 px outline in the ring colour, inset where an element sits flush against a clipping edge. Two deliberate variants: the suggestion proposal keeps the ring but pairs it with a 2 px outline offset outward instead of the 1 px partner, and the Conversation scroller is the only outline-only one, a 2 px inset outline, because its column clips. A `--rating` colour token replaces raw amber on every star: the star primitive, the inbox list, the property dashboard and the property list (#587).                                                                                                                                                                                                                                       |
| P4-5 `shadow-xs` selection cue              | Open                   | Cosmetic.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| P4-6 DESIGN.md is stale                     | Open                   | The standard should describe `--warn` and the real spacing grid; that is the design owner's document to change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| P5-1 prop collapse                          | Landed                 | `DetailContentProps` 15 → 6 props; both callers lost a ten-line copy block.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| P5-2 … P5-5                                 | Open                   | Refactors of working code.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### Left for a product decision

The last review of the rebased diff disputed two findings. Both start from
behaviour main already has, and each needs a product call rather than a fix.

- **A failed `Use draft` is reported twice.** When saving an adopted AI draft
  fails, the suggestion row says "The suggested draft could not be saved. Try
  again." and autosave says "AI draft could not be saved. Your previous draft is
  unchanged." The adopt path is main's; this PR made both lines live regions, so
  both are now announced. Autosave's `Retry save` then writes the AI text as a
  plain draft without its provenance token, while the box still shows the old
  text. Which line should speak, and whether `Retry save` should be offered for
  text the box never showed, is the decision.
- **A refusal that lands after a keystroke is dropped.** If the manager types
  while a draft is generating and the server answers with a refusal (busy,
  provider unavailable and the like), the answer fails the same freshness check
  a draft must pass: the spinner stops with no message, countdown or template
  offer. A thrown failure is reported (P0-1). The comment in
  `use-reply-suggestion.ts` now says this plainly. The next click asks again,
  and a busy refusal keeps its idempotency key. Whether a refusal should outlive
  an edit is the decision.

### Mistakes made along the way, and corrected

After the first review, every round found defects in the fixes themselves:
loop 2, the pre-PR review, a final verification of the pre-PR fixes, and the
review of the rebased diff.

**Loop 2** (adversarial review of the first fixes): the first autosave change
rested on a false premise (a debounced draft never lives in `pending`) and was
reverted; the focus-ring change dropped three controls from 4.53:1 to 1.96:1;
`aria-disabled` had been applied to blocks with nothing to explain; a contrast
table had been relabelled rather than remeasured.

**Pre-PR review** (six lenses over the exact diff, three skeptics per finding,
40 of 41 upheld):

- _High._ The second pass's `schedule()` change cleared the failed-save guard,
  so a failed template save followed by Undo read as `Saved` and let Submit send
  the template the manager had undone. Fixed at the root: a failed save leaves
  no confirmed copy, so the next save is always real. The sticky-error branch
  that change added never fired for the case it was written for, and is gone.
- The teardown save was dropped whenever a save was already in flight
  (`dispose()` cleared the queue it had just joined); it now chains after it.
- A save resolving after a change of selection wrote its reply into the NEW
  item's cache; reply writes were keyed on the review the mutation was for. On
  the rebase, main's own fix from #578 replaced this one.
- Arrow keys on the newly focusable Conversation region opened the next case.
- The reopen command reported every refusal twice; a submit refusal was not
  announced at all (on main, #578's submit toast reports it).
- The automated story migration dropped one story's internal note and orphaned
  a docs comment.
- Thirteen comments and document claims were false or stale.
- Several fixes had no test. They have now, and each was checked by reverting
  the fix it covers — including one whose first version could never fail,
  because a `vi.fn()` spy marks its own rejected promises as handled.

The same pass found that this document had claimed two fixes it had not made —
the _Template loaded_ live region and the assist menus' disabled primaries.
Both are now done.

**Final verification** (five lenses over only the fixes above, three skeptics
per finding, 14 of 14 upheld — all low or medium):

- The composer slot's new outline never rendered (`TabsContent`'s
  `outline-none` sets the outline style to none), and the draft-origin tag still
  had only the half-opacity ring. Both fixed.
- The "no confirmed copy after a failure" rule missed template loads, which
  write outside the coordinator; covered now by `invalidate()` before each load.
- The reopen dialog could be dismissed mid-request, leaving a refusal nowhere.
- ArrowDown on a menu trigger opened the menu and switched case (pre-existing;
  the new guard was the natural place to fix it).
- Several fixes were still untested at the branch that mattered — the teardown
  write's `pending` path and its skip guard, the assist menus' click guard, and
  the removal of the stale template error line. Each has a test now that fails
  when its fix is reverted.
- Three test files crossed the 300-line limit; their new cases moved to sibling
  files, the repo's existing convention.

**Landing on main.** The fixes were rebased onto main after #569–#590, with
conflicts resolved main-first. The rebased diff was then reviewed again (two
voters per finding: 47 of 49 confirmed, 2 disputed and listed above, none
refuted). What that turned up, all fixed here:

- Where #578 had fixed the same defect, main's version was kept: the mutation
  error toast, reply-result routing and its test, and `submitAfterSave`.
- Main's `submitAfterSave` still left a sentence of the composer's own after a
  failed save, which waited behind autosave's line and surfaced, under a head
  reading `Saved`, once a retry or a keystroke cleared it. The review's helper
  hid it in exactly that case, which left a channel that could never render.
  Both went; the line under Submit is autosave's alone.
- The named reads had been written before main's governed queues added
  `findReviewIdsByReplyStage` to the reply lookup (#569); the named object now
  carries it.
- #569 had moved the thread scroller into `inbox-detail-regions.tsx`, so the
  Conversation section was rebuilt there.
- Main's `e` shortcut issued escalate and resolve with a bare `void` — the
  unhandled rejection already fixed in the toolbar. It settles them now.
- Once the toolbar commands used `actionErrorMessage`, a second revision
  conflict toasted the generic failure; it is now thrown as a 409 refusal, so
  the pane's own sentence is what the manager reads.
- `invalidate()` missed a save already in flight, which could still re-confirm
  the server's copy; saves now carry a `generation`.
- Verification proposed re-sending, on teardown, text whose save had failed.
  It was built, then reverted: a token-less `Use draft` saves before the
  composer adopts it, and a save can fail after Delete draft, so the failed
  text is not reliably what the box shows. The choice is now documented on
  `flushOnTeardown` and pinned by a test.
- A successful Confirm Reject still dropped focus to `<body>`.
- An unclassifiable reply wore the "Needs a check" chip, which asks for a check
  it does not offer.
- The arrow-key guard also caught dialog triggers, which have no arrow-key
  handling, so the arrows stopped walking the list on them.
- The property list (#587) still drew raw amber stars.
- The query-key comment and the product-state ledger blamed the settings pages
  for the extra refetches; the caller was the on-demand analysis poll.
- The list's row clock (`formatCompactAge`, #569) built a date formatter per
  call.
- A `Retry save` that failed again was an unhandled rejection (main's code).
- Two of the three ported suggestion fixes had no test; each has a story now.
- Tailwind scans `docs/`, so this document's own spelled-out class names were
  compiling into the stylesheet the bundle budget measures, roughly 70 B gzip.
  It now describes styles in words.
- Further comments were false after the rebase: the detail read's reply
  precedence and its permission note, the reopen dialog's claim that every
  refusal lands in its banner (the list's bulk reopen reports its own), and
  this document's own status rows. All corrected.

### Verification

Run locally on Node 22.23.2 on this change rebased onto main. CI runs on the
PR as well. No figure measured before the rebase is quoted here.

| Gate                                                                               | Result                                 |
| ---------------------------------------------------------------------------------- | -------------------------------------- |
| `pnpm typecheck`                                                                   | Pass                                   |
| `pnpm lint:ci` (eslint, boundaries, test quality, product-state, runtime contract) | Pass                                   |
| Prettier on every changed file                                                     | Pass                                   |
| Unit                                                                               | 1,026 files, 9,981 tests pass          |
| Storybook (chromium)                                                               | 110 files, 932 tests pass              |
| Integration (real PostgreSQL, private database)                                    | 199 files, 1,153 tests pass            |
| `pnpm check:changed-code`                                                          | Pass                                   |
| `pnpm build` + `pnpm check:bundles`                                                | Initial closure 328,591 B of 329,105 B |

The code gates ran before the final rebase onto #594, which changed only the
stylesheet's scan list and a comment in the budget script; the build and the
budget ran after it. The closure is 16 B below main's 328,607 B: the rating
token and the new focus and visibility rules cost less than the raw amber
utilities they retire. That margin exists because #594 stopped the stylesheet
scanning `docs/`, `review/` and `e2e/` — before it, this document's own class
names were charged to first paint against the 9 B #590 had left.

### Known limits

- **A teardown write is invisible to an immediate remount of the same item.**
  Crossing the 1078 px compact-layout floor (`INBOX_DESKTOP_MIN_VIEWPORT` in
  `use-inbox-compact-layout.ts`) — resizing a desktop window, or rotating a
  tablet — swaps the sheet for the desktop pane, or back, in one commit. If that
  happens within 700 ms of a keystroke, the old mount's
  teardown now saves the text (before this change it was lost), but the new
  mount has already seeded its box from the cached draft: the box shows the
  older text while the server holds the newer, and Submit sends the newer. The
  internal-note draft is lost outright on the same swap, because it is local
  state in `InboxDetailContent`, which each layout mounts separately. Closing
  both means holding the two drafts per review above the `isCompactLayout`
  branch in `inbox-page-v2.tsx`.
- **Reply-result routing is main's (#578), and pinned for one command.**
  `reply-result-routing.test.ts` pins the policy, and pins the check command's
  mutation options across a mid-request option swap (it calls `setOptions` on
  the pending observer). The other reply commands' `changed()` in
  `use-reply-actions.ts` reads `command.data.reviewId` the same way, but no test
  swaps options under them.

### Found in passing, not fixed

- `inboxKeys.activity(id)` is still invalidated on a 2.5 s delay after every
  status command, but nothing observes it since the activity timeline was
  removed; the key, the delay and `getActivityTimeline` on `InboxServerFns` are
  dead.

## Claims checked and rejected

- _"The Storybook metrics harness is not wired into CI."_ True but **deliberate
  and documented** — `docs/plan/inbox-detail-v2.md` row 20 records that a
  path-scoped job was written and proven (502 passing in CI mode) and held out of
  the tree because ~6 min of Chromium per PR is a budget decision. A product
  decision, not a defect.
- _"E2E assertions were weakened."_ No. Per-file assertion deltas are net
  positive or neutral; nothing was silently dropped.
