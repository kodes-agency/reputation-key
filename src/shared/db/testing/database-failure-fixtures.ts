// A failed write as the stack raises it, for the suites that decide what a log
// line may say about one: Drizzle's query error around node-postgres's refusal.
// Both are the real classes, so the fixture cannot drift from what production
// throws. Drizzle writes the bound values into the message, the stack and a
// `params` field; the server adds them to `detail`.

import { DrizzleQueryError } from 'drizzle-orm/errors'
import { DatabaseError } from 'pg'

export const FAILED_WRITE_CONSTRAINT = 'feedback_text_unique'

/** A unique violation on `feedback`, with `privateText` wherever a real one holds a value. */
export function failedFeedbackWrite(privateText: string): DrizzleQueryError {
  const refusal = Object.assign(
    new DatabaseError(
      `duplicate key value violates unique constraint "${FAILED_WRITE_CONSTRAINT}"`,
      120,
      'error',
    ),
    {
      severity: 'ERROR',
      code: '23505',
      detail: `Key (text)=(${privateText}) already exists.`,
      schema: 'public',
      table: 'feedback',
      constraint: FAILED_WRITE_CONSTRAINT,
    },
  )
  return new DrizzleQueryError(
    'insert into "feedback" ("text") values ($1)',
    [privateText],
    refusal,
  )
}
