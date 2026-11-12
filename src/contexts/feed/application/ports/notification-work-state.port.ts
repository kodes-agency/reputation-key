import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { NotificationType } from '../../domain/notification-types'
import type { NotificationWorkDecision } from '../../domain/notification-actionable'

export type NotificationWorkSubject = Readonly<{
  organizationId: OrganizationId
  type: NotificationType
  resourceId: string
  /**
   * The audience the notice was queued under. A grouped reopen's work is the
   * cycles its audience names; nothing else reads it.
   */
  audience?: unknown
  /**
   * The reader the notice is for, on the Property it is filed under. A grouped
   * assignment counts the items still theirs; asked without one it cannot
   * count, and passes.
   */
  recipient?: Readonly<{ userId: UserId; propertyId: PropertyId | null }>
}>

export type NotificationWorkState = Readonly<{
  /** Asked before a notice is written and again before its email leaves. */
  isWaiting: (subject: NotificationWorkSubject) => Promise<NotificationWorkDecision>
  /**
   * The same question for many notices at once, in order. Each Inbox item and
   * each reply is read once however many notices stand on it, so a digest
   * asks the owners per item, not per line.
   */
  isWaitingMany: (
    subjects: ReadonlyArray<NotificationWorkSubject>,
  ) => Promise<ReadonlyArray<NotificationWorkDecision>>
  /**
   * Of the types a settling fact names, the ones it may retire now: their
   * work is done, or cannot be checked. A type whose work was asked for again
   * since the fact happened keeps its notice.
   */
  finished: (
    input: Readonly<{
      organizationId: OrganizationId
      resourceId: string
      types: ReadonlyArray<NotificationType>
    }>,
  ) => Promise<ReadonlyArray<NotificationType>>
}>
