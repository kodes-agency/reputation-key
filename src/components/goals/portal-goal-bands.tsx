// The questions on the Monthly portal goal's page (2026-11-01, ADR 0068): each is a
// check-in band, the question and its answer beside what shows it. The words are
// `portal-goal-bands-view.ts`'.
import { Link } from '@tanstack/react-router'
import { CalendarDays, Flag, Pencil, QrCode } from 'lucide-react'
import type { PortalGoalMeasure } from '#/contexts/reporting/application/dto/goal-recommendation.types'
import type { PortalGoalPageView } from '#/contexts/reporting/application/dto/monthly-portal-goal-page.types'
import type {
  PortalGoalOfCard,
  PortalGoalRunningMonth,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import { CheckInSection } from '#/components/features/shared/check-in-section'
import { usePermissions } from '#/shared/hooks/usePermissions'
import {
  GOAL_ACTION_LINK,
  GoalActionButton,
  GoalActionRows,
  GoalActionWords,
} from './goal-action-row'
import { GoalColumns } from './goal-columns'
import {
  changeNumberNote,
  compareBand,
  monthBars,
  quietRow,
  todoBand,
  whereBand,
  type PortalBandIcon,
  type PortalBandWords,
} from './portal-goal-bands-view'
import { PortalGoalFromPortals } from './portal-goal-from-portals'
import { fromPortalsWords } from './portal-goal-page-view'
import { FROM_YOUR_PORTALS_ID } from './portal-goal-portal-counts'

const ICONS = {
  where: QrCode,
  months: CalendarDays,
  flag: Flag,
} as const satisfies Readonly<Record<PortalBandIcon, unknown>>

const ROW_ICON = 'size-5'

/** Where the card's "See each" lands: below the sticky header. */
const ANCHOR_MARGIN = { scrollMarginTop: '6rem' } as const

function Band({
  words,
  children,
}: Readonly<{ words: PortalBandWords; children: React.ReactNode }>) {
  const Icon = ICONS[words.icon]
  return (
    <CheckInSection
      title={words.title}
      icon={<Icon aria-hidden="true" className="size-4" />}
      answer={words.answer}
      hint={words.hint ?? undefined}
      tone={words.tone}
    >
      {children}
    </CheckInSection>
  )
}

type PageProps = Readonly<{ page: PortalGoalPageView; propertyId: string }>

/** Each Portal's count and the quiet ones; nothing when there is neither. */
export function PortalGoalWhereBand({ page, propertyId }: PageProps) {
  const words = fromPortalsWords(page.rows, page.facts, page.portals)
  const band = whereBand(words)
  if (band === null) return null
  return (
    <div id={FROM_YOUR_PORTALS_ID} style={ANCHOR_MARGIN}>
      <Band words={band}>
        <PortalGoalFromPortals propertyId={propertyId} words={words} />
      </Band>
    </div>
  )
}

/** Each month against its own number; under two months there is nothing to compare yet. */
export function PortalGoalCompareBand({
  goal,
  page,
  measure,
}: Readonly<{
  goal: PortalGoalOfCard
  page: PortalGoalPageView
  measure: PortalGoalMeasure
}>) {
  const bars = monthBars(page.months, measure, page.today)
  return (
    <Band words={compareBand(goal.month, page.tiles)}>
      {bars === null ? (
        <p className="py-2 text-sm text-muted-foreground">
          Each month will build up here, against its own number.
        </p>
      ) : (
        <>
          <GoalColumns
            caption={bars.caption}
            columns={bars.columns}
            label="Each month; use left and right arrows to read each one."
            hint="Hover or tap a bar to read that month."
          />
          {bars.earlier === null ? null : (
            <p className="pb-2 text-sm text-muted-foreground">{bars.earlier}</p>
          )}
        </>
      )}
    </Band>
  )
}

/** What a manager can do: each row only where it applies and they may follow it. */
export function PortalGoalTodoBand({
  page,
  propertyId,
  measure,
  month,
  single,
  onChangeNumber,
}: PageProps &
  Readonly<{
    measure: PortalGoalMeasure
    month: PortalGoalRunningMonth | null
    single: boolean
    onChangeNumber?: () => void
  }>) {
  const { can } = usePermissions()
  const quiet = single ? [] : fromPortalsWords(page.rows, page.facts, page.portals).quiet
  return (
    <Band words={todoBand(measure, month)}>
      <GoalActionRows>
        {quiet.map((fact) => (
          <Link
            key={fact.portalId}
            className={GOAL_ACTION_LINK}
            to="/properties/$propertyId/portals/$portalId"
            params={{ propertyId, portalId: fact.portalId }}
            search={{ tab: 'share' }}
          >
            <GoalActionWords
              icon={<QrCode className={ROW_ICON} />}
              {...quietRow(fact.name)}
            />
          </Link>
        ))}
        {quiet.length === 0 && can('portal.read') ? (
          <Link
            className={GOAL_ACTION_LINK}
            to="/properties/$propertyId/portals"
            params={{ propertyId }}
          >
            <GoalActionWords
              icon={<QrCode className={ROW_ICON} />}
              title="Open your portals"
              note="See each code, print it again, or move it."
            />
          </Link>
        ) : null}
        {onChangeNumber === undefined ? null : (
          <GoalActionButton
            icon={<Pencil className={ROW_ICON} />}
            title="Change the number"
            note={changeNumberNote(page.tiles)}
            onClick={onChangeNumber}
          />
        )}
      </GoalActionRows>
    </Band>
  )
}
