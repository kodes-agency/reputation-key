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

- `ops:queue <status|pause|resume> <queue>` — pause/resume a BullMQ queue (containment; jobs preserved). §3/§7
- `ops:quarantine <list|redrive <id>|discard <id>>` — inspect failure quarantine, redrive enabled work, or discard blocked/quarantined work without execution. §4/§7
- `ops:refresh reviews` — enqueue one bounded Review refresh-sweep run. §3/§4
- `ops:purge <reviews|reviews-shadow|retention>` — report Review lifecycle eligibility, Review expand/cache parity, or the static-rule retention backlog. Review targets are content-free and report-only even when enqueued; they never grant destructive apply. `retention --apply` remains destructive and requires typed confirmation. Do not treat local Review reports as production erasure or parity evidence. Inspect Google import lifecycle through the read-only health/database surfaces in runbook §10.
- `ops:rebuild-projection --org <id> [--property <id>]` — repair the inbox projection (bounded, dry-run report first). §5
- `ops:rebuild-metric-projection <portalId> --org <id> --property <id>` — inspect or repair one anonymous Portal lifetime projection from its sealed baseline plus retained governed facts. Dry-run is the default; apply requires `--reason`. §7
- `ops:reconcile-publication <replyId> | --all-ambiguous [--resume <token>]` — reconcile ambiguous Google reply publication (one frozen keyset page; provider re-read, never a send). §6
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
- `ops:gbp-subscribe --org <id>` — re-assert the organization's GBP `notificationSetting` at `GBP_PUBSUB_TOPIC` (idempotent PATCH per connection). Dry-run by default; `--reason <text> --apply` executes. Run it (a) to backfill tenants that connected before the import path subscribed automatically, and (b) after ANY change to `GBP_PUBSUB_TOPIC` — Google stores the topic on the GBP account, so existing subscriptions keep publishing to the old topic until this re-runs. Exits 1 on any candidate short of `subscribed`. §2
- `ops:restore-preflight` — guided runbook §8 restore preflight (isolated-target check, journal readability, backup-window checklist); NOT a PITR executor — restore is platform-owned. §8
- `ops:restore-verify` — restore-drill report and sealed apply surface (requires `RESTORE_MODE=isolated` plus an attested loopback/Railway PITR sibling target). Dry-run emits the bounded inventories and exact aggregate-only Review approval artifacts. Apply remains unavailable unless an independently reviewed, current, trusted Ed25519 bundle binds the exact target/run/generation/policy/report; a one-shot durable receipt rejects retargeting and reuse. See `review-lifecycle-recovery-approval.md`. Local code/tests are not a Railway drill or serving proof. §8
- Current on Google has no operator mutation or standalone rebuild command. Review publishes its content-minimal aggregate only after a double-scan-verified provider run and bounded reconciliation; Metric stores it outside bounded-period readings and hides it after a source-epoch rebind.
- Organization lifecycle has an Identity-owned request/status/recoverable-cancel application seam, quarantined bounded worker families, and a read-only `ops:report-organization-lifecycle` diagnostic. It still has no manager route, mutating independently authorized operator command, reviewed contributor set, cleanup/export/purge apply, or reactivation command. Follow `organization-lifecycle.md`. Never clear the Organization suspension merely because a lifecycle request was canceled.

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
