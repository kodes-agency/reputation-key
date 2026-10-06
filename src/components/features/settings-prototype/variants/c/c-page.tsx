// PROTOTYPE — variant C. The page beside the sidebar: the standard page frame (the
// 1200 PageShell, a PageHeader whose h1 sits where every other page's does) and the
// open section in the 768 form column. Only the overview, a table or a matrix, takes
// the whole frame. The sidebar draws the property and the way around; the header says
// what this page is about and, on a phone, carries the pickers.
import type { ReactNode } from 'react'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { Badge } from '#/components/ui/badge'
import type { SettingsPrototypeContext } from '../../settings-prototype-types'
import { PhonePickers } from './c-phone-pickers'
import { SECTION_BLURB, SectionBody } from './c-sections'

/** The quiet line under the title: what this page is about, and whether it is read only. */
function metaOf(ctx: SettingsPrototypeContext): readonly ReactNode[] {
  const { current, property, data } = ctx
  // The overview says how many properties and how many need setup in its own summary line.
  if (current.key === 'overview') return []
  const subject =
    current.group === 'all'
      ? `${data.properties.length} properties`
      : current.group === 'business'
        ? (property?.name ?? data.workspace.name)
        : current.group === 'you'
          ? data.viewer.name
          : data.workspace.name
  return current.locked
    ? [
        subject,
        <Badge key="locked" variant="neutral">
          Read only
        </Badge>,
      ]
    : [subject]
}

export function SettingsPageC({ ctx }: Readonly<{ ctx: SettingsPrototypeContext }>) {
  const isWide = ctx.current.key === 'overview'
  return (
    // pb-16 clears the prototype switcher bar, which floats over the bottom of the page.
    <PageShell tier="dashboard" className="pb-16">
      <PageHeader
        title={ctx.current.label}
        meta={metaOf(ctx)}
        description={SECTION_BLURB[ctx.current.key]}
      />
      <PhonePickers ctx={ctx} />
      <div className={isWide ? 'min-w-0' : 'max-w-3xl min-w-0'}>
        <SectionBody ctx={ctx} />
      </div>
    </PageShell>
  )
}
