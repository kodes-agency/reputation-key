# Verifying closed beta obligations

The [obligations](../obligations.md) remain the authority, including every
outstanding promise and every explicit gap. Tests named there prove behaviour
under their fixtures. They do not prove that a live deletion, email, provider
setting or recovery ran. These procedures supply a verification path where a
test cannot. A missing result remains open; writing a procedure closes nothing.

The accountable owner owns these checks. Record the date, responsible operator,
release revision, scope, expected result, actual result and evidence location in
the private operational record. Record counts and short identifiers, not customer
content, secrets or public incident details. Never mark a promise fulfilled from
code presence alone. Destructive checks run only through an approved operational
path; an isolated synthetic fixture is the default for behavioural checks.

## Launch blockers

Before outside access, check the deadlines in [obligations §6](../obligations.md#launch-blockers).
The owner performs external submissions and account changes. Keep each item open
until its evidence exists in the private operational record:

1. **OAuth publishing:** inspect the production OAuth project's publishing
   status and record that it is out of Testing. With an outside Google account
   that has access to a test Business Profile, complete consent, callback and a
   successful provider read through the application. Check renewal and repeat
   the read beyond the former seven-day Testing limit; record timestamps and
   outcomes without tokens or customer content. A console status or an owner's
   existing connection alone is not proof of outside access. Resolve refusals
   before admitting the first outside customer; keep reconnecting beta accounts
   every seven days while Testing remains in use.
2. **Staff question:** before the production submission, send Google the question
   about staff QR codes and scan targets. Retain the dated outgoing message and
   submission reference in the Google correspondence record; record Google's
   answer or pending status and track required follow-up. Compare the sent date
   with the production submission date. Do not include a question about retention
   assumptions or treat a draft as sent correspondence.
3. **Repository ownership and visibility:** before the first outside customer or
   hire, transfer this repository to a GitHub organization and make it private
   as one coordinated move. Confirm the same repository identifier, organization
   owner and private visibility in GitHub; do not convert the personal account.
   Verify Railway and Sentry integrations still have repository access, CI runs
   for the transferred repository, and strict branch protection and retained
   required checks still work. Check whether CodeQL's
   `Analyze (javascript-typescript)` is available on the private plan; resolve an
   unavailable required check before changing visibility so PRs are not stranded.
   Record the integration results and final settings before granting outside
   access. An organization transfer alone or private visibility alone is
   incomplete.

## Product acceptance

Use a local or isolated test Organization with an AccountAdmin, a PropertyManager
with one Property grant, an unrelated Organization and a Staff account. Use
synthetic Google transport, email and AI. For each row, check all the listed
outcomes against the corresponding paragraphs of obligations §3, including their
boundary values. Save failures as issues; do not remove a feature to pass a row.
Existing behavioural tests cited in the contract remain part of the proof.

| Commitments                                  | Manual procedure and expected result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 and §3 Accounts                           | Try signup and a second active Organization membership; both refuse. Bootstrap only an empty fixture, then repeat and expect refusal. Invite, accept, expire, resend and reset a password; acceptance and reset verify the address. Try manager administration as each role, with a suspended Organization, a killed invite capability and isolated restore mode. Refusals leave invitations pending and write no account. Verify no MFA or billing promise is shown, and the operator console requires recent sign-in.                                                                                                                                                                                                                                                                                                                               |
| §1 and §3 Properties                         | Edit country and timezone and verify existing data stays in place. Check the manager app and operational email remain English. Import and relink synthetic primary categories, including empty and unknown values; they change only AI vocabulary hints, not access, sorting, profile or AI epochs. Verify no venue-type control appears. Inspect deployment placement read-only against §1; the UI offers no region choice.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| §2 and §3 Portal journeys                    | Publish both rating-first and skip-private-rating Portals. Exercise every rating and thresholds 1 and 5; threshold 3 includes 3, while 0 and 6 refuse. The verified Google action must be identical for every rating. Make the destination stale, awaiting refresh and unavailable: no stale URI renders and the private path remains usable. Check Linktree actions from arrival and after rating on the current publication, and retained behaviour of older issued publications. No action claims a completed Google review.                                                                                                                                                                                                                                                                                                                       |
| §3 Portal management and media               | Publish, group, archive and restore a Portal: restoration is Disabled until republished; creator provenance stays fixed. Remove a responsible manager's access and verify delivery chooses only eligible managers or the AccountAdmin fallback. Exercise every reachable own-look and print option. Upload allowed images and confirm re-encoding strips metadata; reject SVG, GIF, HEIC, animated and oversized input. Verify rights confirmation, storage cap, same-origin access, takedown and garbage collection as described in §8.                                                                                                                                                                                                                                                                                                              |
| §3 Guest responses and contact containment   | Submit a synthetic rating and note in a signed session, correct once, refuse another correction and withdraw the whole response. Exercise the 24-hour feedback boundary under the procedure below. Verify the disabled contact capability exposes no guest collection or reveal; retained contact data cannot leak into analytics, routine exports or AI. Contact requests must not be enabled before their own notice and privacy checks. No guest message is sent.                                                                                                                                                                                                                                                                                                                                                                                  |
| §3 Google and Review                         | As AccountAdmin connect, reauthorize, import more than one batch, reconnect and disconnect; as an unauthorized role expect refusal. Verify interrupted import resumes and its batch bound is not a product selection cap. Exercise push, targeted fetch, adaptive discovery and manual recovery with a missed push and provider failure. Compare timing to the documented interval, skip rule, spread and retry limits rather than treating a polling interval as a delivery guarantee. Re-observe an expired Review: identity and manager history remain stable. Only original text or rating changes create a Material Review Revision.                                                                                                                                                                                                             |
| §3 Inbox, assignment and targets             | Close and reopen an item, assign an eligible manager, remove their grant, escalate, set manual priority and change personal seen state independently. Assignment grants no access. Trigger a material revision and a lost provider reply: a new cycle preserves history and fences obsolete publication and AI text while preserving manager drafts. Check each completion source, target range, historical-import exclusion, overdue derivation, halfway and target-passed dedupe, Google pre-read delay and private-feedback Mark as handled/withdrawal behaviour. Bulk Reopen remains available; bulk Close refuses. Use the detailed [target procedure](inbox-response-targets.md).                                                                                                                                                               |
| §2, §3 and §5 Replies                        | Submit and explicitly Confirm & Publish with an authorized manager, including the author. Wrong role, tenant, Property, revision, cycle, attempt and payload must refuse. Put an answer on synthetic Google between draft and publish: pre-read ends the stale publication without sending. Simulate an uncertain write and reconcile by reading, never blindly resending. Preserve the documented race between Google's read and unconditional upsert as a residual risk.                                                                                                                                                                                                                                                                                                                                                                            |
| §2 and §3 AI authorization and effects       | Exercise independent per-Property opt-ins, revoke, disable, policy kill and suspended Organization. Refuse unknown execution bindings and out-of-force notices before provider work. Check compatible notice renewal preserves unaffected epochs, explicit new capabilities still require opt-in, disabled heads stay disabled and the announcement receipt is not consent. Withhold stale-lineage outputs. AI never receives private feedback, contact details, internal notes or another Property's source. Analysis cannot change manager work; the permitted Urgent alert contains no source text and follows existing recipients/preferences. Verify drafting stream cancellation, adoption ending AI authorship and the currently documented fallback and grounding rules.                                                                      |
| §3 Metrics and goals                         | Exercise each of the three allowed measures at Property, Group and Portal scope, the Monthly portal goal and Google rating goal. Google actions count selections, never completions. Check every skip-rating conflict in both directions, aggregate attribution, readiness and low-sample states, history and the retained pace/forecast behaviours. Google rating goals remain manager-only and Property-local; no Google values become staff goals, rankings or incentives. Preserve all reachable goal types, including average and multi-subject goals.                                                                                                                                                                                                                                                                                           |
| §3 Staff and the dated staff-account entries | Invite, link an existing member, interrupt/resume onboarding, repair an invitation and remove staff at their last Property. Member login grants no Property access; removal denies self reads before archival. Public pages/print metadata use the fixed public name and opaque address; identifying print margins stay outside the cut piece. Own-Organization visits count nothing. Check yesterday's rating cutoff and five-rating floor, scans-only colleague list in name order with zero-scan people, default-off visibility, own Code/results/notice and manager My code. Verify each batch resend/group move and the restrictions on scan targets. Staff never see private notes, individual ratings, Google selections, rankings, praise or pace. The business must communicate the staff-use restrictions in §3 before using these figures. |
| §3 Notifications and beta feedback           | Check scoped responsible recipients, actor suppression, delivery revalidation, unread versus resolved state, digest, quiet hours, mute/undo and mandatory delivery exceptions against §3 and [notification runbooks](runbooks.md). Submit each feedback type and all impact values. A screenshot requires the documented byte/type checks; masked layout requires per-report consent, preview and removal and stays first-party. Public issue text contains neither reporter words nor pseudonyms. Triage outcomes reach the reporter's Bell and feedback marker.                                                                                                                                                                                                                                                                                     |
| §3 and §5 Monitoring and architecture        | Run the existing privacy-exfiltration, browser-reachability, content-free-facts, no-auto-publish, tenant-policy and command/outbox suites named in §5. In a synthetic browser session verify idle navigation sends no monitoring session record; a failure sends only the allowed scrubbed error or withheld-report count. Confirm feedback attachments and geometry follow the distinct paths described above. Do not treat a source scan as live detection of an incident.                                                                                                                                                                                                                                                                                                                                                                          |
| Draft usage measurement after §10            | Generate, rewrite, adopt, edit, undo, reload, submit and observe publication of synthetic drafts. Verify no fallback or pre-provider refusal becomes a generation, edits clear active AI authorship, reload reports unavailable distance rather than zero, and only the saved generation/revision accepts scalars. Check transactionally recorded adoption/submission/publication, content-free rows, aggregate-only operator output, cascade retention and each authorized erasure path described in that section.                                                                                                                                                                                                                                                                                                                                   |

## Provider and notice commitments

Before first use, at a provider/account change and at a material data-use change:

1. Compare outbound fixtures against obligations §2: one Property, eligible Google
   source only, approved redaction, no reviewer name or prior-reply few-shot
   context, human publication and no cross-Property combination. Run the named
   source, authorization, notice-digest and provider-transport tests.
2. The owner checks provider account controls and applicable agreements for no
   training opt-in, cache duration, provider retention and any processing-location
   claim. Save dated evidence. Repository assertion strings cannot establish
   these facts. An unverified setting or changed term remains an open obligation.
3. Compare the published Privacy Notice, Participation Agreement, Google Access
   Disclosure and merchant AI notice with their approved versions/digests and
   served routes. Run the published-document tests. Follow the published change
   and notification rules, including the waiting period for a newly named AI
   provider, before sending it Google content. Do not infer permission from a
   provider being named or from an old waiver.
4. The pending Google restatement and the assumptions about refresh and limited
   storage remain the owner's decisions, not completed correspondence. Preserve
   the correspondence in `docs/external/google/`. No daily star-count writer or
   backfill is promised: the dated 2026-11-04 decision stands, while the existing
   notice wording awaits its separately approved revision.

## Withdrawal, rights and closure deadlines

Before declaring the 24-hour private-feedback withdrawal promise verified, use
synthetic responses and a controlled clock just before and at expiry. Withdraw
from the same signed session, then verify all manager reads, Inbox state,
handling reminders, derivatives and retained receipts. No withdrawn text may
remain readable. Record the result; a unit test is not evidence of a live
withdrawal or erasure. The promise stays open until that evidence exists.

On a rights request, the owner records receipt and the published deadline,
verifies identity and scope without collecting unnecessary data, and tracks the
response within 30 days and an eligible requested export within seven days.
Use the published contact channel; never send the response through a public
issue. Follow the [lifecycle restrictions](organization-lifecycle.md) and
[privacy incident procedure](runbooks.md) §21. For closure, preserve suspension,
mandatory warnings, export on request, typed purge confirmation and an erasure
record. Retained unarmed self-service code is not an available procedure.

If the supported manual execution tool or a contributor is missing, escalate to
the owner immediately and keep the request and deadline open. Do not improvise a
purge, bypass a quarantine or record completion. A deadline-tracking procedure
does not itself implement the outstanding rights-execution tooling.

## Retention and erasure evidence

For every data class and horizon in obligations §§2–3 and the
[security inventory](../security/data-inventory.md), compare the scheduler,
retention rule and last successful outcome. Check overdue eligible rows using
content-free counts; an unscheduled job or a successful zero-work quarantined
handler is not erasure proof. Use isolated aged fixtures to verify the cutoff,
batch cap, failure retry and cascade; then inspect approved live execution
records independently. Include all of these cases:

- Current Google source and superseded observations at their fetch-based expiry;
  disconnection, lapse or archival never reset that clock or erase early.
- Private text, contacts, pressure and abuse pseudonyms, session bindings and
  mirrored identifiers, and both idempotency-receipt scopes at their distinct
  horizons. Session expiry is not receipt deletion.
- Guest facts at their calendar-month deadline, Reporting readings and
  corrections, staff-attributed readings, v2 and v3 AI derivatives, issue groups,
  provider operation metadata and linked draft measurements. A rule for the
  source table does not prove its projections disappeared.
- Feedback layouts, outbox facts and receipts, sync/import histories, operational
  evidence and every other independently retained class in the inventory.
- AI disable/revoke immediately fences work and reads; verify the promised local
  derivative erasure within 24 hours through the supported authorized path.
- Non-repeatable erasures require the applicable journal before deletion and
  restore replay proof. Failure must leave data intact and alert. Age-based work
  must run again after restore. Do not activate a quarantined path for a check.

The explicitly UNENFORCED items in the contract stay open until their actual
execution evidence exists. Verify bucket expiry and provider-side deletion
separately from database counts. Include every backup, including Manual copies,
in the published 30-day ceiling; an indefinite Manual copy is unresolved.

Checked 2026-11-06 (read-only, Railway API): the beta Postgres volume has two
backup schedules, daily copies kept 6 days and weekly copies kept 27 days, and two
backups, both scheduled and both expiring by 2026-11-11. No Manual copy remains;
the last was deleted on 2026-11-05. The detached volume restored for the
2026-11-04 rehearsal is scheduled for deletion on 2026-11-08. Recheck before each
notice revision.

## Release, recovery and stop conditions

At release, complete every item in obligations §6 and record its observed result:
exact green CI revision, migration and construct parity, HTTP readiness, the
review-to-published-reply journey, backup verification within 30 days and a named
24-hour watch. [Operator commands](operator-commands.md) and
[runbooks](runbooks.md) supply executable steps. Never replace the supported
forward-repair path with an earlier image after migrations.

For obligations §7, inspect PITR interval and dated backup records. The
2026-11-04 isolated data restore passed, reached the chosen moment and accepted
connections after 36.5 minutes; it did not establish worst-case duration, full
RTO or erasure replay. Preserve that evidence. Verify RPO against the loss
interval and RTO against a full return to operational state, including replay
when required, before claiming either target proven.

For each of the seven stop conditions in §7, use an isolated planted failure or
an incident report to verify the applicable runbook, external-effect stop,
queue handling and canonical-data preservation. In particular, test worker loss
from outside that worker, phone delivery of the alert channel, alert retries and
observation loss. Map detection to the actual alert registry; record human-only
and unimplemented coverage honestly. Zero duplicate replies/emails and zero loss
of committed work require independent provider/mail records and fault-injection
results, not merely a quiet dashboard.

Review each signed exception's reachability, mitigation, owner, expiry and issue
at release. Expiry requires remediation or an explicit new decision; it does not
silently extend itself. Deferred capabilities stay refused until their stated
activation conditions, including technical media safeguards, are met.
