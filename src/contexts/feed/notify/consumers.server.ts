import { eventConsumerReceipts } from '#/shared/db/schema/outbox.schema'
import type { OrganizationId, UserId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { ConsumerResult } from '#/shared/outbox/consumer-registry'
import type {
  NotificationAudienceAuthorizer,
  NotificationAudience,
} from '../application/notification-audience'
import type { NotificationWorkState } from '../application/notification-work-state'
import type { UserLookupPort } from '../application/ports/notification-user-lookup.port'
import type { InsertNotificationInput } from '../application/use-cases/insert-notification'
import {
  enqueueImmediateAfterCommit,
  writeNoticeInTransaction,
  type NoticeWriteSettings,
} from './notice-write.server'

/**
 * One notice a consumer decided to raise: who gets it, about what, and why the
 * recipient may (the audience, rechecked as the notice is written). The source
 * event comes from the delivery, not from the notice.
 */
export type Notice = Omit<InsertNotificationInput, 'eventId'> &
  Readonly<{ audience: NotificationAudience }>

type ReceiptStatus = Extract<ConsumerResult['status'], 'applied' | 'obsolete'>

/** A grouped notice says how many of its items still stood when it was delivered. */
const withItemCount = (
  input: InsertNotificationInput,
  itemCount: number,
): InsertNotificationInput => ({
  ...input,
  payload: {
    ...(typeof input.payload === 'object' && input.payload !== null ? input.payload : {}),
    itemCount,
  },
})

/** Claims a consumer's receipt and writes its notices on one transaction. */
export type NoticeWriter = Readonly<{
  write: (
    delivery: Readonly<{
      eventId: string
      consumerName: string
      status: ReceiptStatus
      notices: ReadonlyArray<Notice>
    }>,
  ) => Promise<ReceiptStatus | 'duplicate'>
}>

type NoticeWriterDeps = NoticeWriteSettings &
  Readonly<{
    authorizeAudience: NotificationAudienceAuthorizer
    workState: Pick<NotificationWorkState, 'isWaiting'>
  }>

/**
 * The writer the worker hands its consumers. The receipt claim, the notices,
 * their email-queue rows and the receipt's outcome commit together, so a
 * failure anywhere leaves no receipt and the outbox redelivers the whole fact;
 * a redelivery that finds the receipt claimed writes nothing and so cannot bump
 * a notice's repeat count. Whether each recipient still qualifies, and whether
 * the work is still waiting, is decided just before the write, as the queued
 * job decided it on delivery; a fact whose every notice was suppressed settles
 * its receipt `obsolete` and logs why. Redis sees the immediate emails only
 * after commit.
 */
export const createNoticeWriter = (deps: NoticeWriterDeps): NoticeWriter => ({
  write: async ({ eventId, consumerName, status, notices }) => {
    const deliverable: InsertNotificationInput[] = []
    const audiences: NotificationAudience[] = []
    for (const { audience, ...notice } of notices) {
      const input = { ...notice, eventId }
      const logger = deps.logger.child({ type: input.type })
      const decision = await deps.authorizeAudience({
        userId: input.userId,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        audience,
      })
      if (decision === false) {
        logger.info(
          { audienceKind: audience.kind },
          'Notification suppressed: recipient is no longer eligible',
        )
        continue
      }
      const waiting = await deps.workState.isWaiting({
        organizationId: input.organizationId,
        type: input.type,
        resourceId: input.resourceId,
        audience,
        recipient: { userId: input.userId, propertyId: input.propertyId },
      })
      if (waiting === false) {
        logger.info('Notification suppressed: its work is already done')
        continue
      }
      deliverable.push(
        decision === true ? input : withItemCount(input, decision.itemCount),
      )
      audiences.push(audience)
    }
    const settledStatus: ReceiptStatus =
      notices.length > 0 && deliverable.length === 0 ? 'obsolete' : status

    const outcome = await deps.db.transaction(async (tx) => {
      const claimed = await tx
        .insert(eventConsumerReceipts)
        .values({ eventId, consumerName, status: settledStatus })
        .onConflictDoNothing()
        .returning({ eventId: eventConsumerReceipts.eventId })
      if (claimed.length === 0) return null

      const emails = []
      for (const [index, input] of deliverable.entries()) {
        emails.push(await writeNoticeInTransaction(deps, tx, input, audiences[index]!))
      }
      return emails
    })

    if (outcome === null) return 'duplicate'
    for (const email of outcome) await enqueueImmediateAfterCommit(deps, email)
    return settledStatus
  },
})

export type NoticeDeliveryDeps = Readonly<{
  noticeWriter: NoticeWriter
}>

type DeliveryOptions = Readonly<{
  /** The receipt's outcome; `obsolete` for a fact that can never raise a notice. */
  status?: ReceiptStatus
}>

/**
 * Raise a consumer's notices for the event it handles and record its receipt.
 * Every consumer of the account, integration, Portal and Property routes ends
 * here, so the receipt is never written before the notices exist.
 */
export async function deliverNotices(
  deps: NoticeDeliveryDeps,
  event: Readonly<{ eventId: string }>,
  consumerName: string,
  notices: ReadonlyArray<Notice>,
  options: DeliveryOptions = {},
): Promise<ConsumerResult> {
  const outcome = await deps.noticeWriter.write({
    eventId: event.eventId,
    consumerName,
    status: options.status ?? 'applied',
    notices,
  })
  return { status: outcome }
}

/**
 * The AccountAdmins of an Organization, less anyone the notice must not reach
 * (the person whose own action raised it). Says why when nobody is left, so a
 * silent route stays visible in the log.
 */
export async function findAccountAdminRecipients(
  deps: Readonly<{
    userLookup: Pick<UserLookupPort, 'findByRole'>
    logger: LoggerPort
  }>,
  organizationId: OrganizationId,
  none: Readonly<{
    message: string
    context: Record<string, unknown>
    except?: UserId | null
  }>,
): Promise<ReadonlyArray<UserId>> {
  const admins = await deps.userLookup.findByRole(organizationId, 'AccountAdmin')
  const recipients = admins.filter((admin) => admin !== (none.except ?? null))
  if (recipients.length === 0) deps.logger.warn(none.context, none.message)
  return recipients
}
