// Monthly portal goal — what the Goals page card read returns (types only).
//
// No zod and no values: a component imports these with `import type`, so
// nothing here reaches a bundle (PLAN E10). The server decides every state,
// day and number; the card only words them (PLAN E12). Days are
// Property-local `YYYY-MM-DD`, months `YYYY-MM`.

/** One published Portal's steps before the number is ready (P-4). */
export type PortalReadinessRow = Readonly<{
  portalId: string
  name: string
  live: boolean
  /** Its code is made and its QR or NFC marker published. */
  codeMade: boolean
  /** A scan has arrived since that code was made. */
  firstScan: boolean
  /**
   * The local days since its code was made, once 14 or more have passed with
   * no scan; null otherwise (a younger code, or one that has been scanned).
   */
  noScanSinceCodeDays: number | null
}>

/** This month so far at the Property, per measure; null where it cannot be read. */
export type PortalGoalSoFar = Readonly<{ ratings: number | null; scans: number | null }>

/** What the card shows of the first weeks: each Portal's steps and the month so far. */
export type PortalGoalFirstWeeks = Readonly<{
  /** The Property's local day today, for the header tile. */
  today: string
  /** This month. */
  month: string
  soFar: PortalGoalSoFar
  /** Published Portals, in name order. */
  portals: readonly PortalReadinessRow[]
}>

/**
 * The card's arm. Before a goal: no Portal at all (or none live and no draft),
 * draft Portals only, the first weeks, a number ready (with scans only, scans
 * first), nothing counted, or a recommendation that cannot be read. With one:
 * the goal, by Program.
 */
export type PortalGoalCardView =
  | Readonly<{ state: 'no_portal' }>
  | Readonly<{
      state: 'drafts_only'
      drafts: readonly Readonly<{ portalId: string; name: string }>[]
    }>
  | (PortalGoalFirstWeeks &
      Readonly<{
        state: 'getting_ready'
        /** When the closest live Portal has 2 weeks live; null when that is not known. */
        readyOn: string | null
      }>)
  | (PortalGoalFirstWeeks & Readonly<{ state: 'ready' | 'scans_only' }>)
  | Readonly<{
      state: 'nothing_counted'
      /** The weeks the basis covers: "No scans in the last 2 weeks." */
      weeks: 2 | 3 | 4
    }>
  | Readonly<{ state: 'recommendation_unreadable' }>
  | Readonly<{ state: 'goal'; goal: Readonly<{ programId: string }> }>

export type PortalGoalCardState = PortalGoalCardView['state']
