// PROTOTYPE — a section opened from the home: a way back to Settings, the section's name
// with its status in tone, a "Jump to" menu (and, for a property's own sections, the
// property switcher), then the shared section content in the same frame as the home.
import type { ReactNode } from 'react'
import { PageHeader } from '#/components/layout/page-header'
import { PageShell } from '#/components/layout/page-shell'
import { BackLink } from '#/components/ui/back-link'
import { cn } from '#/lib/utils'
import { SettingsPrototypeSection } from '../../settings-prototype-sections'
import type { RailRow, SettingsPrototypeContext } from '../../settings-prototype-types'
import { HeaderRow } from './b-header-row'
import { BJumpMenuSlot } from './b-section-actions'
import { isAllOnly, labelOf, type SettingsHome } from './b-model'
import { ToneLine } from './b-tone'

/** Under the title: which scope an all-properties row is about, then its status in tone. */
function metaOf(row: RailRow, home: SettingsHome): readonly ReactNode[] | undefined {
  const items: ReactNode[] = []
  if (isAllOnly(row.key) && home.all !== null) items.push('All properties')
  if (row.statusText !== '') {
    items.push(<ToneLine key="status" tone={row.tone} text={row.statusText} />)
  }
  return items.length === 0 ? undefined : items
}

export function SectionPage({
  home,
  open,
}: Readonly<{ home: SettingsHome; open: SettingsPrototypeContext }>) {
  const row = open.current
  return (
    <PageShell className="pb-20">
      <div className="space-y-3">
        <BackLink
          to="/settings-prototype"
          search={(previous) => ({ ...previous, section: undefined })}
          label="Back to Settings"
          flush
        />
        <HeaderRow
          header={<PageHeader title={labelOf(row)} meta={metaOf(row, home)} />}
          controls={<BJumpMenuSlot home={home} open={open} />}
        />
      </div>
      <div className={cn(row.key === 'overview' ? '' : 'max-w-3xl')}>
        <SettingsPrototypeSection ctx={open} bare />
      </div>
    </PageShell>
  )
}
