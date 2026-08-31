import type { ResponseTargetStore } from '../ports/response-target.store'

export const RESPONSE_TARGET_REMINDER_RELEASE_LIMIT = 100

export type ReleaseDueResponseTargetRemindersDeps = Readonly<{
  targetStore: Pick<ResponseTargetStore, 'releaseDueReminders'>
  clock: () => Date
}>
export type ReleaseDueResponseTargetRemindersInput = void
export type ReleaseDueResponseTargetReminders = ReturnType<
  typeof releaseDueResponseTargetReminders
>

/** One bounded scheduler pass; a later tick owns any remaining due slots. */
export const releaseDueResponseTargetReminders = (
  deps: ReleaseDueResponseTargetRemindersDeps,
) => {
  return () =>
    deps.targetStore.releaseDueReminders({
      now: deps.clock(),
      limit: RESPONSE_TARGET_REMINDER_RELEASE_LIMIT,
    })
}
