// Types and phrase joiners shared by every notification renderer. The renderers live in
// ./notification-templates.ts and its family files; this module imports none of them.
import type { NotificationPayload } from './notification-payload'

/**
 * What the reader's own clock is, for the one fact that only means anything
 * on it: a Response Target's target time. Copy stays English — this module is
 * the only place copy exists — so only the zone crosses. Absent on a surface
 * that cannot know it (the frozen snapshot written at insert time), and the
 * clause is then left out rather than guessed in UTC.
 */
export type NotificationRenderContext = Readonly<{ timeZone: string }>

/** What a rendered notification exposes to every channel. */
export type RenderedNotification = Readonly<{
  /** Short, imperative where an action is required. Never empty. */
  title: string
  /** One supporting sentence. Empty string when the title says everything. */
  body: string
  /**
   * What the in-app row shows under its title: the part of the body the title
   * and the row's facts line do not already say — a reason, a cause, a count,
   * a target time. Empty when the body only restates the title or says to open
   * the item, which the row itself is for. Never carries the repeat sentence:
   * the row shows how often a notice repeated as a fact.
   */
  detail: string
  /**
   * A notice that states several facts, one sentence each: the email lists them as
   * paragraphs instead of running them together (`body` is the same sentences in a row).
   * Absent for every notice that is one sentence.
   */
  lines?: readonly string[]
  /** Primary action label, imperative, <= 3 words. */
  actionLabel: string
  /** Extra context line for email only (digest rows and the urgent preheader). */
  summary: string
  /**
   * Email footer wording for a notice with no off switch, in this notice's own
   * words. Mandatory mail has no preferences link, so the footer is the only
   * place it can say why it arrived, and one generic sentence for every
   * account notice told a reader nothing. Absent for optional mail, whose
   * footer points at the preference it came from.
   */
  whyReceived?: string
}>

/** What a per-type renderer returns: `detail` defaults to "nothing to add". */
export type RendererCopy = Omit<RenderedNotification, 'detail'> &
  Readonly<{ detail?: string }>

/** " · Riverside Hotel" style suffix, or "" when the name is unknown. */
export const atProperty = (payload: NotificationPayload): string =>
  payload.propertyName === undefined ? '' : ` at ${payload.propertyName}`

/** Joins non-empty clauses with a single space. Keeps sentences clean when metadata is missing. */
export const sentence = (...parts: ReadonlyArray<string>): string =>
  parts.filter((part) => part !== '').join(' ')

/** Joins non-empty facts with a middot for the compact metadata line. */
export const facts = (...parts: ReadonlyArray<string>): string =>
  parts.filter((part) => part !== '').join(' · ')

/** The facts line, led by the Property. */
export const factsAt = (
  p: NotificationPayload,
  ...parts: ReadonlyArray<string>
): string => facts(p.propertyName ?? '', ...parts)
