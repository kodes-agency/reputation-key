// Who sent a beta feedback report, for the operator reading it in Sentry
// (Privacy Notice 2.5, owner decision 2026-10-16).
//
// The scrubber still runs over the whole report and keeps only its message and
// source. This processor runs after it, last, and adds the reporter's account
// name and email to the feedback context, where Sentry shows them in place of
// "Anonymous User". Both come from the account record the server looked up for
// the signed-in reporter, never from anything the report itself carries.

export type FeedbackReporter = Readonly<{ name: string | null; email: string }>

const MAX_NAME_LENGTH = 120
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}$/u

type EventRecord = Readonly<Record<string, unknown>>

function asRecord(value: unknown): EventRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as EventRecord)
    : undefined
}

export function withFeedbackReporter(
  reporter: FeedbackReporter,
): (event: unknown) => unknown {
  const name = reporter.name?.replace(/\s+/gu, ' ').trim().slice(0, MAX_NAME_LENGTH)
  const email = EMAIL.test(reporter.email) ? reporter.email : undefined
  return (event) => {
    const record = asRecord(event)
    if (record?.type !== 'feedback') return event
    const contexts = asRecord(record.contexts)
    return {
      ...record,
      contexts: {
        ...contexts,
        feedback: {
          ...asRecord(contexts?.feedback),
          ...(name ? { name } : {}),
          ...(email ? { contact_email: email } : {}),
        },
      },
    }
  }
}
