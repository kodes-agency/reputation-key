// PROTOTYPE — the many-properties Overview: a filterable matrix (setup, Google, AI,
// target per property) with search, row selection and bulk apply behind a preview.
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { ClearFiltersButton } from '#/components/ui/clear-filters-button'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '#/components/ui/data-table'
import { ListToolbar, ListToolbarStatus } from '#/components/ui/list-toolbar'
import { ResultCount } from '#/components/ui/result-count'
import { SearchField } from '#/components/ui/search-field'
import { setupProgressOf } from '../settings-prototype-fixtures'
import { hrefOf } from '../settings-prototype-model'
import { SettingsPrototypeLink } from '../settings-prototype-nav'
import type { PropertyFixture, PrototypeRole } from '../settings-prototype-types'
import { MatrixBulkBar } from './prototype-matrix-bulk'
import { OVERVIEW_COLUMNS, overviewCells } from './prototype-overview-cells'
import { OverviewSummary } from './prototype-overview-section'
import type { SectionProps } from './prototype-section-kit'

type FilterKey = 'needs' | 'notLinked' | 'aiUndecided' | 'custom'

const FILTERS: ReadonlyArray<
  Readonly<{
    key: FilterKey
    label: string
    test: (p: PropertyFixture, role: PrototypeRole) => boolean
  }>
> = [
  {
    key: 'needs',
    label: 'Needs setup',
    test: (p, role) => setupProgressOf(p, role).nextStep !== null,
  },
  { key: 'notLinked', label: 'Not linked', test: (p) => p.google.state !== 'linked' },
  { key: 'aiUndecided', label: 'AI undecided', test: (p) => p.ai === 'undecided' },
  { key: 'custom', label: 'Custom target', test: (p) => p.targets.mode === 'custom' },
]

const toggled = <T,>(set: ReadonlySet<T>, item: T): ReadonlySet<T> =>
  set.has(item) ? new Set([...set].filter((x) => x !== item)) : new Set([...set, item])

export function MatrixOverview({ ctx }: SectionProps) {
  const role = ctx.state.role
  const all = ctx.data.properties
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<ReadonlySet<FilterKey>>(new Set())
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())

  const needle = query.trim().toLowerCase()
  const shown = all.filter(
    (p) =>
      (needle === '' || `${p.name} ${p.city}`.toLowerCase().includes(needle)) &&
      FILTERS.every((f) => !active.has(f.key) || f.test(p, role)),
  )
  const narrowed = needle !== '' || active.size > 0
  const allShown = shown.length > 0 && shown.every((p) => selected.has(p.id))
  const someShown = shown.some((p) => selected.has(p.id))
  const chosen = all.filter((p) => selected.has(p.id))

  const toggleAll = () =>
    setSelected(allShown ? new Set() : new Set([...selected, ...shown.map((p) => p.id)]))

  return (
    <div className="space-y-4">
      <OverviewSummary ctx={ctx} />
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Show properties that"
      >
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={active.has(f.key) ? 'secondary' : 'outline'}
            aria-pressed={active.has(f.key)}
            onClick={() => setActive(toggled(active, f.key))}
          >
            {f.label} {all.filter((p) => f.test(p, role)).length}
          </Button>
        ))}
      </div>
      <ListToolbar>
        <SearchField label="Search properties" value={query} onValueChange={setQuery} />
        <ListToolbarStatus>
          <ResultCount shown={shown.length} total={all.length} active={narrowed} />
          {narrowed ? (
            <ClearFiltersButton
              searching={needle !== ''}
              onClear={() => {
                setQuery('')
                setActive(new Set())
              }}
            />
          ) : null}
        </ListToolbarStatus>
      </ListToolbar>
      {chosen.length > 0 ? (
        <MatrixBulkBar
          selected={chosen}
          data={ctx.data}
          onApplied={() => setSelected(new Set())}
        />
      ) : null}
      <DataTable label="Properties" layout="scroll">
        <DataTableHeader>
          <DataTableHead className="w-10">
            <Checkbox
              aria-label="Select every property shown"
              checked={allShown ? true : someShown ? 'indeterminate' : false}
              onCheckedChange={toggleAll}
            />
          </DataTableHead>
          <DataTableHead>Property</DataTableHead>
          {OVERVIEW_COLUMNS.map((column) => (
            <DataTableHead key={column}>{column}</DataTableHead>
          ))}
        </DataTableHeader>
        <DataTableBody>
          {shown.map((p) => (
            <DataTableRow key={p.id}>
              <DataTableCell className="w-10">
                <Checkbox
                  aria-label={`Select ${p.name}`}
                  checked={selected.has(p.id)}
                  onCheckedChange={() => setSelected(toggled(selected, p.id))}
                />
              </DataTableCell>
              <DataTableCell className="font-medium">
                <SettingsPrototypeLink
                  href={hrefOf(ctx.shape, 'details', 'property', p.id)}
                  className="text-link hover:underline"
                >
                  {p.name}
                </SettingsPrototypeLink>
              </DataTableCell>
              {overviewCells(p, ctx.data, role).map((cell, i) => (
                <DataTableCell key={OVERVIEW_COLUMNS[i]}>{cell}</DataTableCell>
              ))}
            </DataTableRow>
          ))}
        </DataTableBody>
      </DataTable>
    </div>
  )
}
