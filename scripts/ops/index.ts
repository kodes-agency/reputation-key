import { spawnSync } from 'node:child_process'

const COMMANDS: Readonly<Record<string, readonly [file: string, ...args: string[]]>> =
  Object.freeze({
    'ai-approve-enrollment': ['scripts/ops/ai-approve-enrollment.ts'],
    'ai-control': ['scripts/ops/ai-execution-control.ts'],
    'bootstrap-owner': ['scripts/ops/bootstrap-owner.ts'],
    'disconnect-connection': ['scripts/ops/disconnect-connection.ts'],
    'gbp-subscribe': ['scripts/ops/gbp-subscribe.ts'],
    'google-admission-role': ['scripts/ops/provision-google-admission-role.ts'],
    inspect: ['scripts/ops/inspect-decision.ts'],
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

function printCommands(): void {
  const names = Object.keys(COMMANDS).sort()
  const width = Math.max(...names.map((name) => name.length))
  console.log('Available operator commands:')
  for (const name of names) {
    console.log(`  ${name.padEnd(width)}  tsx ${COMMANDS[name]?.join(' ')}`)
  }
}

const [name, ...args] = process.argv.slice(2)
if (!name) {
  printCommands()
  process.exit(0)
}

const command = COMMANDS[name]
if (!command) {
  console.error(`Unknown operator command: ${name}`)
  printCommands()
  process.exit(1)
}

const [file, ...defaultArgs] = command
const result = spawnSync('tsx', [file, ...defaultArgs, ...args], { stdio: 'inherit' })
if (result.error) {
  console.error(`Failed to start ${name}: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
