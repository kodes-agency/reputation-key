// Pure generator: BQC status manifest → human-readable markdown tables (BQC-0.1).
// The JSON file is source of truth; this output is regenerable and must not be hand-edited.

import type { BqcStatusManifest, BqcEntry } from './status-schema'

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function entryRow(entry: BqcEntry): string {
  const findings = entry.openFindings.length > 0 ? entry.openFindings.join(', ') : '—'
  const pr = entry.implementation?.pr ?? '—'
  const blocked =
    entry.state === 'blocked'
      ? `${entry.blockedDependency ?? '?'} (review ${entry.nextReviewDate ?? '?'})`
      : '—'
  return `| ${escapeCell(entry.id)} | ${escapeCell(entry.kind)} | ${escapeCell(entry.title)} | \`${entry.state}\` | ${escapeCell(entry.owner)} | ${escapeCell(pr)} | ${escapeCell(findings)} | ${escapeCell(blocked)} |`
}

export function generateBqcStatusMarkdown(manifest: BqcStatusManifest): string {
  const phases = manifest.entries.filter((e) => e.kind === 'phase')
  const slices = manifest.entries.filter((e) => e.kind === 'slice')

  const lines: string[] = [
    '# BQC live program status',
    '',
    '> **Generated file.** Do not edit by hand. Source: `status/bqc-status.json`.',
    `> Regenerate: \`pnpm bqc:generate-status\`. Schema: \`src/shared/bqc/status-schema.ts\`.`,
    '',
    `**Program:** ${manifest.program}  `,
    `**Manifest updated:** ${manifest.updatedAt}  `,
    `**Validation report:** ${manifest.baseline.validationReport}  `,
    `**Validation baseline SHA:** \`${manifest.baseline.validationBaselineSha}\`  `,
  ]

  if (manifest.baseline.workingTreeSha) {
    lines.push(
      `**Working tree SHA (status describes):** \`${manifest.baseline.workingTreeSha}\`  `,
    )
  }
  if (manifest.baseline.lockfileSha256) {
    lines.push(`**Lockfile SHA-256:** \`${manifest.baseline.lockfileSha256}\`  `)
  }
  if (manifest.baseline.migrationVersion) {
    lines.push(`**Migration version:** ${manifest.baseline.migrationVersion}  `)
  }
  if (manifest.baseline.notes) {
    lines.push('', manifest.baseline.notes)
  }

  lines.push(
    '',
    '## Status vocabulary',
    '',
    'Only these states are valid: `not_started`, `implementation_in_progress`, `implementation_complete`, `evidence_pending`, `accepted`, `blocked`.',
    '',
    '`Merged` / `code complete` / `docs complete` are **not** completion states.',
    '',
    '## Phases',
    '',
    '| ID | Kind | Title | State | Owner | PR | Open findings | Blocked |',
    '| -- | ---- | ----- | ----- | ----- | -- | ------------- | ------- |',
    ...phases.map(entryRow),
    '',
    '## Slices',
    '',
    '| ID | Kind | Title | State | Owner | PR | Open findings | Blocked |',
    '| -- | ---- | ----- | ----- | ----- | -- | ------------- | ------- |',
  )

  if (slices.length === 0) {
    lines.push('| — | — | _(no slices recorded)_ | — | — | — | — | — |')
  } else {
    lines.push(...slices.map(entryRow))
  }

  lines.push(
    '',
    '## Historical BQR work',
    '',
    'BQR phase documents remain historical intent/implementation records. Live completion truth for beta is this file and `status/bqc-status.json` only.',
    '',
  )

  return `${lines.join('\n')}\n`
}
