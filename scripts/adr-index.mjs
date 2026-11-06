import { readdir, readFile, writeFile } from 'node:fs/promises'

// Historical locations are pinned so generation also works in shallow checkouts.
// Each revision belongs to the history preserved by docs-archive-2026-11-05.
const ARCHIVED_ADRS = [
  {
    number: '0001',
    title: 'Cross-context communication through typed PublicApi surfaces',
    ref: '8505b32c64f8fad2289c59d8a20044ec35dfc8ee',
    file: '0001-cross-context-public-api.md',
  },
  {
    number: '0001',
    title: 'Dynamic Access Control via Better-auth',
    ref: 'fe129e06c5f00800c157d9b92a3c5257cbba7f87',
    file: '0001-dynamic-access-control.md',
  },
  {
    number: '0002',
    title: 'Section-Based Navigation with Role-Distinct Sidebars',
    ref: 'fe129e06c5f00800c157d9b92a3c5257cbba7f87',
    file: '0002-section-based-navigation.md',
  },
  {
    number: '0003',
    title: 'Review as a Separate Bounded Context',
    ref: 'fe129e06c5f00800c157d9b92a3c5257cbba7f87',
    file: '0003-review-bounded-context.md',
  },
  {
    number: '0004',
    title: 'Inbox as a Separate Bounded Context',
    ref: 'fe129e06c5f00800c157d9b92a3c5257cbba7f87',
    file: '0004-inbox-bounded-context.md',
  },
  {
    number: '0005',
    title: 'GBP Review API Path and Error Model Fix',
    ref: 'fe129e06c5f00800c157d9b92a3c5257cbba7f87',
    file: '0005-gbp-review-api-fix.md',
  },
  {
    number: '0006',
    title: 'Staff as a Separate Bounded Context',
    ref: 'fe129e06c5f00800c157d9b92a3c5257cbba7f87',
    file: '0006-staff-bounded-context.md',
  },
  {
    number: '0009',
    title: 'Permission Model',
    ref: 'fe129e06c5f00800c157d9b92a3c5257cbba7f87',
    file: '0009-permission-model.md',
  },
  {
    number: '0010',
    title: 'Activity Context: BullMQ Event Delivery',
    ref: 'fe129e06c5f00800c157d9b92a3c5257cbba7f87',
    file: '0010-activity-bullmq-delivery.md',
  },
  {
    number: '0011',
    title: 'Notification Context: BullMQ Event Delivery',
    ref: 'fe129e06c5f00800c157d9b92a3c5257cbba7f87',
    file: '0011-notification-bullmq-delivery.md',
  },
  {
    number: '0012',
    title: 'Nitro Vite Plugin — Dev-Mode Exclusion',
    ref: 'fe129e06c5f00800c157d9b92a3c5257cbba7f87',
    file: '0012-nitro-dev-mode-exclusion.md',
  },
  {
    number: '0013',
    title: 'Portal Groups Replace Team and Staff as Goal/Leaderboard Scopes',
    ref: 'c5979c2478dcdefd2a99ab9dfdcb63065f548924',
    file: '0013-portal-groups-replace-team-staff-scope.md',
  },
  {
    number: '0014',
    title: 'Badges and Leaderboards as Separate Recognition Contexts',
    ref: 'c5979c2478dcdefd2a99ab9dfdcb63065f548924',
    file: '0014-badges-and-leaderboards-separate-contexts.md',
  },
  {
    number: '0018',
    title: 'Injectable Container',
    ref: 'fe129e06c5f00800c157d9b92a3c5257cbba7f87',
    file: '0018-injectable-container.md',
  },
  {
    number: '0019',
    title: 'Simulation Harness & Deterministic Backends',
    ref: 'docs-archive-2026-11-04',
    file: '0019-simulation-harness.md',
  },
  {
    number: '0020',
    title: 'The Goal Model Is Progress-Only; Level and Ratio Goals Deferred',
    ref: 'fe129e06c5f00800c157d9b92a3c5257cbba7f87',
    file: '0020-progress-only-goal-model.md',
  },
  {
    number: '0021',
    title:
      'Leaderboard: Remove Composite Score; Per-Metric Leaderboards + Comparison Matrix',
    ref: 'c5979c2478dcdefd2a99ab9dfdcb63065f548924',
    file: '0021-leaderboard-remove-composite-add-matrix.md',
  },
  {
    number: '0022',
    title: 'Notification resource resolved to the inbox item at creation',
    ref: 'fe129e06c5f00800c157d9b92a3c5257cbba7f87',
    file: '0022-notification-resource-resolved-at-creation.md',
  },
  {
    number: '0039',
    title: 'People, Access, and Attribution Are Separate Effective-Dated Concepts',
    ref: 'fe129e06c5f00800c157d9b92a3c5257cbba7f87',
    file: '0039-people-access-and-attribution.md',
  },
  {
    number: '0042',
    title: 'Goal Measure Kinds: Progress, Level, and Ratio',
    ref: 'fe129e06c5f00800c157d9b92a3c5257cbba7f87',
    file: '0042-goal-measure-kinds.md',
  },
  {
    number: '0043',
    title: 'Worker Recognition Boundary',
    ref: 'c5979c2478dcdefd2a99ab9dfdcb63065f548924',
    file: '0043-worker-recognition-boundary.md',
  },
  {
    number: '0045',
    title: 'Activity, Audit, and Domain Events Are Three Separate Concepts',
    ref: 'fe129e06c5f00800c157d9b92a3c5257cbba7f87',
    file: '0045-activity-audit-and-domain-events.md',
  },
  {
    number: '0047',
    title: 'Persisted policy state',
    ref: 'fe129e06c5f00800c157d9b92a3c5257cbba7f87',
    file: '0047-persisted-policy-state.md',
  },
  {
    number: '0048',
    title: 'Property region routing',
    ref: 'fe129e06c5f00800c157d9b92a3c5257cbba7f87',
    file: '0048-property-region-routing.md',
  },
  {
    number: '0054',
    title: 'Data Cell catalogue and routing',
    ref: '2948cc45befc39f05c78a51cc433574efd156dc8',
    file: '0054-data-cell-catalogue-and-routing.md',
  },
  {
    number: '0057',
    title: 'Single US beta Data Cell',
    ref: 'fe129e06c5f00800c157d9b92a3c5257cbba7f87',
    file: '0057-single-us-beta-data-cell.md',
  },
  {
    number: '0058',
    title: 'Dedicated Railway projects and IaC-owned source promotion',
    ref: '06309985ab7faa39fca3533db44eca4388bec109',
    file: '0058-dedicated-railway-projects-and-iac-source-promotion.md',
  },
  {
    number: '0059',
    title: 'canary observation window and threshold profile',
    ref: '06309985ab7faa39fca3533db44eca4388bec109',
    file: '0059-rel-01-canary-observation-window.md',
  },
  {
    number: '0060',
    title: 'Machine-checked legal approval',
    ref: '06309985ab7faa39fca3533db44eca4388bec109',
    file: '0060-machine-checked-legal-approval.md',
  },
]

const adrDir = new URL('../docs/adr/', import.meta.url)
const files = (await readdir(adrDir))
  .filter((file) => /^\d{4}-.+\.md$/u.test(file))
  .sort()

const records = await Promise.all(
  files.map(async (file) => {
    const source = await readFile(new URL(file, adrDir), 'utf8')
    const frontmatter = source.match(/^---\n([\s\S]*?)\n---/u)?.[1]
    const title = source.match(/^# \d{4} [—:-] (.+)$/mu)?.[1]
    if (!frontmatter || !title) throw new Error(`Invalid ADR metadata: ${file}`)
    const metadata = Object.fromEntries(
      frontmatter.split('\n').map((line) => {
        const separator = line.indexOf(':')
        return [line.slice(0, separator), line.slice(separator + 1).trim()]
      }),
    )
    return { file, number: file.slice(0, 4), title, ...metadata }
  }),
)

const allRecords = [...records, ...ARCHIVED_ADRS]
const present = new Set(allRecords.map(({ number }) => Number(number)))
const reissuedNumbers = [...new Set(allRecords.map(({ number }) => number))]
  .filter((number) => allRecords.filter((record) => record.number === number).length > 1)
  .sort()
const missing = []
for (let number = 1; number < Number(records.at(-1)?.number ?? 0); number++) {
  if (!present.has(number)) missing.push(number)
}
const ranges = []
for (const number of missing) {
  const previous = ranges.at(-1)
  if (previous?.[1] === number - 1) previous[1] = number
  else ranges.push([number, number])
}
const format = (number) => String(number).padStart(4, '0')
const gaps = ranges
  .map(([start, end]) =>
    start === end ? format(start) : `${format(start)}–${format(end)}`,
  )
  .map((range) => `\`${range}\``)
  .join(', ')
const reissued = new Intl.ListFormat('en', { type: 'conjunction' }).format(
  reissuedNumbers.map((number) => `\`${number}\``),
)

const headers = ['ADR', 'Decision', 'Status', 'Superseded by']
const rows = records.map(
  ({ file, number, title, status, superseded_by: supersededBy }) => [
    `[${number}](${file})`,
    title,
    status,
    supersededBy ?? '—',
  ],
)
const renderTable = (tableHeaders, tableRows) => {
  const widths = tableHeaders.map((header, index) =>
    Math.max(header.length, ...tableRows.map((row) => row[index].length)),
  )
  const renderRow = (cells, separator = false) =>
    `| ${cells
      .map((cell, index) =>
        separator ? '-'.repeat(widths[index]) : cell.padEnd(widths[index]),
      )
      .join(' | ')} |`
  return [
    renderRow(tableHeaders),
    renderRow(tableHeaders, true),
    ...tableRows.map((row) => renderRow(row)),
  ].join('\n')
}
const table = renderTable(headers, rows)
const archived = renderTable(
  ['ADR', 'Decision', 'Location'],
  ARCHIVED_ADRS.map(({ number, title, ref, file }) => [
    number,
    title,
    `[${ref.startsWith('docs-archive-') ? ref : ref.slice(0, 12)}](https://github.com/kodes-agency/reputation-key/blob/${ref}/docs/adr/${file})`,
  ]),
)
const output = `# Architecture Decision Record index

Generated by \`node scripts/adr-index.mjs\` from retained ADR frontmatter and pinned historical locations.
Each issued decision has its own entry and location below. Numbers ${gaps} have no issued ADR in the preserved repository history. Numbers ${reissued} were each issued twice, so cite an ADR by number and title.
The operator-provisioning decision was renumbered from 0063 to [0065](0065-platform-operators-provision-organizations.md).

${table}

## Archived decisions

These records preserve historical rationale; retained ADRs and the
[obligations](../obligations.md) govern current behaviour. Locations name a
protected archive tag or an exact earlier revision in the history preserved by
\`docs-archive-2026-11-05\`.

${archived}

## Archived documentation

Retired [plans](https://github.com/kodes-agency/reputation-key/tree/docs-archive-2026-11-05/docs/plan),
[AI governance documents](https://github.com/kodes-agency/reputation-key/tree/docs-archive-2026-11-05/docs/archive)
and [release evidence](https://github.com/kodes-agency/reputation-key/tree/docs-archive-2026-11-05/docs/release-evidence)
are preserved at protected tag \`docs-archive-2026-11-05\`.
Historical source comments keep their original paths; read them with
\`git show docs-archive-2026-11-05:<path>\`.
`

await writeFile(new URL('README.md', adrDir), output)
