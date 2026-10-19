// The frame every goal's card is drawn in (ADR 0068, amended 2026-10-19: one goal
// design system): the card, its title with the one status pill in the corner, the
// columns a card with a signature visual lays out, and the row its actions sit in.
// Nothing here knows which goal it is drawing: the data-slot, the title and the
// pill come in from the goal, and the markup is the reference goal's, so a card
// that moves onto this frame does not move on the page.
import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { StatusBadge, type StatusPresentation } from '#/components/ui/status-badge'
import { cn } from '#/lib/utils'

type FrameProps = Readonly<{
  /** The card's `data-slot`: how a story, a test and a journey find this card. */
  slot: string
  /** The goal's name; null draws no header, where the page's own title names the card. */
  title: string | null
  /** The title's level: a part of a page under its one h1 is an h2. */
  titleAs?: 'h2' | 'h3'
  /** The title's id: a dialog that closes hands the focus back to the title. */
  titleId?: string
  /** The one pill in the corner; none while the goal has no pace to say. */
  status?: StatusPresentation | null
  /** The card is its own container, so a narrow slot draws its narrow layout at any screen width. */
  container?: boolean
  /** The goal's state as `data-state`, for a story or a journey that waits for one arm. */
  dataState?: string
  children: ReactNode
}>

/**
 * The card, its title and its one pill. The pill drops below the title when the
 * card is too narrow for both, rather than squeezing the title onto two lines.
 */
export function GoalCardFrame({
  slot,
  title,
  titleAs = 'h2',
  titleId,
  status = null,
  container = false,
  dataState,
  children,
}: FrameProps) {
  return (
    <Card
      data-slot={slot}
      data-state={dataState}
      className={cn(container && '@container', 'gap-4')}
    >
      {title === null ? null : (
        <CardHeader className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <CardTitle
            as={titleAs}
            id={titleId}
            tabIndex={-1}
            className="whitespace-nowrap outline-none"
          >
            {title}
          </CardTitle>
          {status === null ? null : <StatusBadge {...status} />}
        </CardHeader>
      )}
      {children}
    </Card>
  )
}

type ColumnsProps = Readonly<{
  /**
   * True when there is a signature visual to give a column to, from a card 48rem
   * wide. Said by the goal and not guessed from `signature`: a goal that has none
   * to draw keeps the plain two-column card.
   */
  wide: boolean
  /** The goal's signature visual, upright in the wide card's own column. */
  signature: ReactNode
  /** What the goal says: its headline and the lines under it. */
  story: ReactNode
  /** How the goal stands: its meter and its way on. */
  side: ReactNode
}>

/**
 * The card's body: the signature visual in a column of its own on a wide card,
 * then the story and the side by side from 40rem, one under the other below it.
 */
export function GoalCardColumns({ wide, signature, story, side }: ColumnsProps) {
  return (
    <CardContent
      className={cn('grid gap-5', wide && '@3xl:grid-cols-[14rem_minmax(0,1fr)]')}
    >
      {signature}
      <div className="grid gap-5 @2xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">{story}</div>
        <div className="flex min-w-0 flex-col gap-4 @2xl:border-l @2xl:pl-6">{side}</div>
      </div>
    </CardContent>
  )
}

/** The card's ways on: tap targets on a phone, not links in a sentence. */
export function GoalCardActions({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="flex flex-wrap gap-2">{children}</div>
}
