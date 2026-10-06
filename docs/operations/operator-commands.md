# Operator commands (BQC-7.5)

Invoke commands as `pnpm ops <name> ...`; `ops:<name>` below is the audited
operation identity. Section references point to [Operational runbooks](runbooks.md).

Every `ops:*` command runs through the operator-command harness
(`scripts/ops/operator-command.ts`). The invocation contract:

- `--operator <id>` — REQUIRED named operator; must be registered in
  `OPS_OPERATOR_IDENTITIES` (unregistered → `operator_not_registered` deny).
- Every invocation (reads included) is evaluated through the ExecutionPolicy
  operator branch. Its typed allow/deny decision and correlation id are printed
  on every run.
- Mutations are DRY-RUN by default; `--apply` executes and requires
  `--reason <text>` (`--ticket <ref>` where the op needs one). Destructive
  commands additionally require the typed confirmation `--yes <command>`.
- Commands that enqueue or redrive work go through the BQC-3 contract
  (`jobEnqueueOptions` / `createRedriveJob`) — never direct handler calls;
  dispatch re-authorizes at execution.

The commands:

- `ops:bootstrap-owner <owner email> <owner name> <organization name>` — create the first Organization and its AccountAdmin (role `owner`) on an EMPTY database, initial password on stdin; refuses once any Organization or membership exists, or any user besides the lone owner an interrupted run left behind. Everything after the Better Auth sign-up commits in one transaction, so re-running the same command after a failure resumes that owner (`ownerAccount: reuse` in the dry run) instead of refusing. The one operator-authored account: every other account is invited from the app. Destructive-class confirmation. Both the dry run and the apply report `controlledBetaCapabilities`: a new Organization is dark for every controlled-beta capability unless `BETA_ALLOWLIST_ORGS` is `*` or names its ID, on web AND worker (ADR 0032, 2026-09-27).
- `ops:storage-cors [--apply]` — check, or with `--apply` set, the object-store bucket's CORS rule that lets the app origin (`BETTER_AUTH_URL`) `PUT` a presigned avatar or logo upload from the browser. Reads the bucket and origin from the web service's Railway variables (no `--operator`; it does not touch the database), uses the pinned S3 SDK, keeps the bucket's existing rules, reads the rule back, and exits 1 unless it is in place. `deploy-ci-images` runs it after every deploy. See `backup-and-lifecycle.md` §3.
- `ops:queue <status|pause|resume> <queue>` — pause/resume a BullMQ queue (containment; jobs preserved). §3/§7
- `ops:quarantine <list|redrive <id>|discard <id>>` — inspect failure quarantine, redrive enabled work, or discard blocked/quarantined work without execution. §4/§7
- `ops:refresh reviews` — enqueue one bounded Review refresh-sweep run. §3/§4
- `ops:purge <reviews|reviews-shadow|retention>` — report Review lifecycle eligibility, Review expand/cache parity, or the static-rule retention backlog. Review targets are content-free and report-only even when enqueued; they never grant destructive apply. `retention --apply` remains destructive and requires typed confirmation. Do not treat local Review reports as production erasure or parity evidence. Inspect Google import lifecycle through the read-only health/database surfaces in runbook §10.
- `ops:rebuild-projection --org <id> [--property <id>]` — repair the inbox projection (bounded, dry-run report first). §5
- `ops:rebuild-metric-projection <portalId> --org <id> --property <id>` — inspect or repair one anonymous Portal lifetime projection from its sealed baseline plus retained governed facts. Dry-run is the default; apply requires `--reason`. §7
- `ops:reconcile-publication <replyId> | --all-ambiguous [--resume <token>]` — reconcile ambiguous Google reply publication (one frozen keyset page; provider re-read, never a send). §6
- `ops:republish-legacy-portals --org <id> [--property <id>] [--batch-size <n>] [--include-pending-edits]` — republish every live Portal whose active version is a v1 or v2 page as the current design (snapshot v3, the Immersive Hub), so every guest sees it and the legacy renderer can be removed. Each Portal goes through the ordinary publish-while-live use case: the same readiness gates, a new version, the previous activation closed as `replaced`, the same facts; the actor on the snapshot, the activation and the fact is `ops:<operator>` (use a short non-personal handle: it is stored in immutable snapshots). The Operational Action History files it as an `operator` row and managers read it as "Reputation Key" in the version history. Dry-run is the default and reports per Portal what would be republished and which would be skipped, with the reason; `--reason <text> --apply` writes. A Portal whose manager has unpublished edits is skipped as `pending_edits` (the republish would put those drafts live under the operator's name; the manager should publish or discard them); `--include-pending-edits` publishes them anyway and the report says how many went live. Idempotent: a republished Portal is on v3 and is not selected again, and a skipped one reports the same reason until it is fixed. Draft-only, disabled, archived and deleted Portals are never selected. Output is identifiers, versions and reason codes only. Exits 1 only if the run stopped at a fault that is not a Portal refusal; the report shows how far it got (`processed` in the totals), the cause is logged to stderr, and a rerun is safe. To see which organisations still have live v1/v2 Portals (the question slice 44 waits on), run this read-only SQL against the database:

  ```sql
  -- live-legacy-portals-by-organization
  SELECT p.organization_id,
         count(*) AS live_legacy_portals,
         count(*) FILTER (WHERE s.configuration->>'schemaVersion' = '1') AS v1,
         count(*) FILTER (WHERE s.configuration->>'schemaVersion' = '2') AS v2
    FROM portals p
    JOIN portal_publication_activations a
      ON a.organization_id = p.organization_id AND a.property_id = p.property_id
     AND a.portal_id = p.id AND a.deactivated_at IS NULL
    JOIN portal_publication_snapshots s
      ON s.organization_id = a.organization_id AND s.property_id = a.property_id
     AND s.portal_id = a.portal_id AND s.id = a.snapshot_id
   WHERE p.publication_state = 'published' AND p.deleted_at IS NULL
     AND s.configuration->>'schemaVersion' IN ('1', '2')
   GROUP BY p.organization_id
   ORDER BY p.organization_id;
  ```

  No rows means no live Portal is left on an old page.

- Contract cleanup checks (round 4, slice 44) — two read-only SQL queries, run against the database of each environment. Migration 0052 settles the first one at deploy (before new code serves); run it before and after, and expect no rows after.

  ```sql
  -- link-labels-newer-than-primary-text: a link whose legacy label was renamed
  -- after its primary-language text (the window between migration 0044 and the
  -- text-aware editor). Readers stop letting the label win in slice 44.
  SELECT l.organization_id, l.portal_id, l.id AS link_id
    FROM portal_links l
    JOIN portals p ON p.organization_id = l.organization_id AND p.id = l.portal_id
    JOIN portal_link_texts t
      ON t.organization_id = l.organization_id AND t.link_id = l.id
     AND t.locale = p.primary_guest_locale
   WHERE length(btrim(l.label)) > 0 AND btrim(l.label) <> t.label
     AND l.updated_at > t.updated_at;
  ```

  ```sql
  -- portal-group-members-without-membership: a row of the legacy
  -- portal_group_members mirror with no matching active
  -- portal_group_memberships row. The Organization Export no longer carries the
  -- mirror, so each row must be represented in the membership table (which the
  -- Staff export carries); no rows means nothing is dropped.
  SELECT m.organization_id, m.portal_group_id, m.portal_id
    FROM portal_group_members m
    LEFT JOIN portal_group_memberships g
      ON g.organization_id = m.organization_id
     AND g.portal_group_id = m.portal_group_id
     AND g.portal_id = m.portal_id AND g.effective_to IS NULL
   WHERE g.id IS NULL;
  ```

- Legacy avatar and logo addresses (round 4, slice 47j) — one read-only SQL query, run against the database of each environment. Migration 0053 clears them at deploy (before new code serves); run it before and after, and expect no rows after. A cleared picture shows the person's initials until they upload again.

  ```sql
  -- legacy-asset-urls: an avatar or logo stored as an amazonaws.com address,
  -- which never loaded (the bucket is private and not on AWS).
  SELECT 'user' AS kind, id FROM "user"
   WHERE image ~* '^https?://[^/]*\.amazonaws\.com(:[0-9]+)?/'
  UNION ALL
  SELECT 'organization', id FROM organization
   WHERE logo ~* '^https?://[^/]*\.amazonaws\.com(:[0-9]+)?/';
  ```

- `ops:reparse-review-translations <report|repair> [--property <id>]` — re-split Google's `(Translated by Google) … (Original)` envelope on Review rows stored before the provider adapter split it at ingestion. A targeted column update: the text, `translated_text`, `content_hash` and AI source provenance are recomputed with the sync path's own functions, and the Review lifecycle, `source_revision` and analysis position are untouched. `report` never writes; `repair` is dry-run by default and `--apply` requires `--reason` and `--ticket`. Idempotent.
- `ops:triage-beta-feedback --operator <id>` — list the global content-free native-feedback support queue. Applying one exact local-reference transition additionally requires all 14 reviewed positional values, `--ticket`, `--reason`, and `--apply`; it is revision/transition-ID guarded, appends immutable evidence, and never reads report text/downloads attachments or creates an engineering issue. §16
- `ops:recover-recent-activity --operator <id> [--batch-size 100] [--apply --reason <text>] <observed-at> [<after-occurred-at> <after-replay-key>]` — report Recent Activity projection readiness or restore one bounded, cursor-resumable page from Activity-owned replay facts. Report-only is the default. See `recent-activity-recovery.md`.
- Operational Action History currently exposes a context-owned restricted
  AccountAdmin list/export seam, wired to current Identity authority, plus internal readiness, hold,
  redaction, and retention-assessment use cases. There is intentionally no
  standalone operator command or destructive retention apply yet. Follow
  `operational-action-history.md`; counsel approval is required before any
  destructive retention path is designed or enabled.
- `ops:inspect policy <permission> <userId> --org <id> [--property <id>] --operator <id>` — explain one read-only ExecutionPolicy decision.
- `ops:disconnect-connection <connectionId> --org <id>` — revoke Google connection credentials (destructive; reconnect completes rotation). §2/§10
- `ops:gbp-subscribe --org <id>` — re-assert the organization's GBP `notificationSetting` at `GBP_PUBSUB_TOPIC` for every account bound to its usable connections (reads each setting, PATCHes only on a difference). Dry-run by default; `--reason <text> --apply` executes. The worker's daily `reconcile-gbp-notification-subscriptions` job runs the same backfill for every organization, so this is only for doing it at once — backfilling accounts imported while push was off, or re-pointing after a `GBP_PUBSUB_TOPIC` change — from a host that reaches the database. Exits 1 on any candidate short of `subscribed` or `already_subscribed`, other than one skipped as inactive or with no bound Property yet (`account_unresolved`). §2
- `ops:restore-preflight` — guided runbook §8 restore preflight (isolated-target check, journal readability, backup-window checklist); NOT a PITR executor — restore is platform-owned. §8
- `ops:restore-verify` — restore-drill report and sealed apply surface (requires `RESTORE_MODE=isolated` plus an attested loopback/Railway PITR sibling target). Dry-run emits the bounded inventories and exact aggregate-only Review approval artifacts. Apply remains unavailable unless an independently reviewed, current, trusted Ed25519 bundle binds the exact target/run/generation/policy/report; a one-shot durable receipt rejects retargeting and reuse. See `review-lifecycle-recovery-approval.md`. Local code/tests are not a Railway drill or serving proof. §8
- Current on Google has no operator mutation or standalone rebuild command. Review publishes its content-minimal aggregate only after a double-scan-verified provider run and bounded reconciliation; Metric stores it outside bounded-period readings and hides it after a source-epoch rebind.
- Organization lifecycle has an Identity-owned request/status/recoverable-cancel application seam, quarantined bounded worker families, and a read-only `ops:report-organization-lifecycle` diagnostic. It still has no manager route, mutating independently authorized operator command, reviewed contributor set, cleanup/export/purge apply, or reactivation command. Follow `organization-lifecycle.md`. Never clear the Organization suspension merely because a lifecycle request was canceled.

### Operator console (web)

`/operator` on the web service is where a platform operator creates each
Organization after the first, without joining it, and invites its first
AccountAdmin (ADR 0065). It lists every Organization with its member,
AccountAdmin and pending-invitation counts, and the open AccountAdmin invitations
of any Organization that has no AccountAdmin yet.

- **Who.** The same `OPS_OPERATOR_IDENTITIES` list that gates the `ops:*`
  commands gates the console, on the **web** service (the worker does not need
  it). A signed-in user whose **account** is listed as `user:<user id>` is an
  operator; everyone else gets Not Found, and an absent or empty list means
  nobody. Email entries keep working for the CLI but never match on web: an
  AccountAdmin can invite a listed address that has no account yet and register
  it through the invitation, so an address proves nothing about who holds the
  account. To add an operator, have them sign in once, read their id
  (`SELECT id FROM "user" WHERE email = '<their email>'`), and append
  `user:<id>` to the list on web.
- **Recent sign-in.** A change (create, invite, resend, cancel) needs a session
  signed in within the last 30 minutes; the page then asks the operator to sign
  in again. Reading the list does not. There is no MFA in the beta, so this is
  the only step-up.
- **Budget.** An operator may make 30 changes an hour; past that the console
  answers 429.
- **Ownerless only.** The console acts on an Organization only while it has no
  AccountAdmin: it can invite another admin, resend or cancel an open admin
  invitation, and (for an invitation) only while the Organization is active. After
  an AccountAdmin accepts, the Organization's own admins manage invitations and
  the console stops showing its invitee addresses. Closing an empty Organization
  is still an ops task.
- **One live admin invitation.** Every open AccountAdmin invitation stays
  acceptable after the first one is accepted, so two live invitations can give
  the Organization two AccountAdmins, and once one has joined the console can no
  longer cancel the other. Cancel a mistaken invitation before inviting the
  right address; the console warns on a row while more than one is live.
- **Allowlist.** A new Organization is dark for every controlled-beta capability
  unless `BETA_ALLOWLIST_ORGS` is `*` or names its ID, on web **and** worker. The
  console flags such an Organization and shows the ID to add; redeploy both after
  changing the list.
- **Audit.** Each change commits one `audit_logs` row with it: the
  Organization (`organization_id`), the operator (`user_id`) and the action
  (`platform.organization_provisioned`, `platform.admin_invited`,
  `platform.admin_invitation_resent`, `platform.admin_invitation_canceled`),
  with the invitation or Organization id as `resource_id`. It is the only
  durable record of who made a console change: log lines carry no identifiers,
  and `identity.invitation.canceled` names no actor. To investigate, query
  `audit_logs WHERE action LIKE 'platform.%'`. The rows are kept 365 days. Each
  change also writes a content-free log line of the same name, and a refused
  attempt logs `platform.operator_denied`.

### Canonical synthetic Google resource

Incident notes, logs, evidence, and provider-support records must never paste a
Google account, location, or review resource. The generated value below is the
only repository documentation example; it is unmistakably synthetic and must
never be sent to Google.

<!-- google-provider-identifiers-v1:start -->

> Generated from `test-fixtures/google-provider-identifiers-v1.json` (google-provider-identifiers-v1, SHA-256 `5c41f1021fb6cdfac15994d5fd7116282a3e5e94b5a3b79708813e091672cd05`). Do not edit this block.
> Canonical synthetic review resource: `accounts/repkey-synthetic-do-not-use-account-0001/locations/repkey-synthetic-do-not-use-location-0001/reviews/repkey-synthetic-do-not-use-review-0001`.

<!-- google-provider-identifiers-v1:end -->

Registered gaps (owned elsewhere, do NOT improvise in an incident):
ENCRYPTION_KEY rotation (platform owner — runbook §2 manual), and PITR execution
(platform owner — `ops:restore-preflight` plus the report-first, independently
approved `ops:restore-verify` are the current app-side surface; the Railway
apply/cutover drill and evidence remain external work; procedure:
docs/operations/backup-and-lifecycle.md).

---
