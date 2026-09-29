// The `pnpm ops <name>` command table. The dispatcher (index.ts) exits the
// process when it runs, so the table lives here, free of side effects, where a
// test can check every documented invocation against it.

export const COMMANDS: Readonly<
  Record<string, readonly [file: string, ...args: string[]]>
> = Object.freeze({
  'ai-approve-enrollment': ['scripts/ops/ai-approve-enrollment.ts'],
  'ai-control': ['scripts/ops/ai-execution-control.ts'],
  'bootstrap-owner': ['scripts/ops/bootstrap-owner.ts'],
  'check-google-oauth': ['scripts/ops/check-google-oauth.ts'],
  'deploy-ci-images': ['scripts/ops/deploy-ci-images.ts'],
  'disconnect-connection': ['scripts/ops/disconnect-connection.ts'],
  'feedback-issue': ['scripts/ops/feedback-issue.ts'],
  'feedback-layout': ['scripts/ops/feedback-layout.ts'],
  'feedback-sync': ['scripts/ops/feedback-sync.ts'],
  'gbp-subscribe': ['scripts/ops/gbp-subscribe.ts'],
  'google-admission-role': ['scripts/ops/provision-google-admission-role.ts'],
  inspect: ['scripts/ops/inspect-decision.ts'],
  'import-reply-templates': ['scripts/ops/import-reply-templates.ts'],
  'permit-start-deadline-fence': ['scripts/ops/permit-start-deadline-backfill.ts'],
  'privacy-request': ['scripts/ops/privacy-request.ts'],
  'property-erase': ['scripts/ops/property-erase.ts'],
  purge: ['scripts/ops/enqueue-purge.ts'],
  quarantine: ['scripts/ops/quarantine-redrive.ts'],
  queue: ['scripts/ops/queue-quarantine.ts'],
  'rebuild-metric-projection': ['scripts/ops/rebuild-metric-projection.ts'],
  'rebuild-projection': ['scripts/ops/rebuild-projection.ts'],
  'reconcile-publication': ['scripts/ops/reconcile-publication.ts'],
  'recover-recent-activity': ['scripts/ops/recover-recent-activity.ts'],
  refresh: ['scripts/ops/enqueue-refresh.ts'],
  'repair-partial-offboarding': ['scripts/ops/repair-partial-offboarding.ts'],
  'reparse-review-translations': ['scripts/ops/reparse-review-translations.ts'],
  'report-capability-refusal': ['scripts/ops/report-capability-refusal.ts'],
  'report-organization-lifecycle': ['scripts/ops/report-organization-lifecycle.ts'],
  'restore-preflight': ['scripts/ops/restore-preflight.ts'],
  'restore-verify': ['scripts/ops/restore-verify.ts'],
  'triage-beta-feedback': ['scripts/ops/triage-beta-feedback.ts'],
})
