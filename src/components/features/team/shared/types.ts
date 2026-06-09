/**
 * Shared types for the team and staff features.
 * Centralised here to avoid duplication across components.
 */

export type MemberOption = Readonly<{
  userId: string
  name: string
  email: string
}>

export type TeamOption = Readonly<{
  id: string
  name: string
}>

export interface AssignmentInTeam {
  readonly id: string
  readonly userId: string
  readonly teamId: string | null
  readonly portalId: string | null
}
