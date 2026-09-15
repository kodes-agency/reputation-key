import { describe, expect, it } from 'vitest'
import { getLogger } from './logger'
import { enrichSpan, getSpanAttrs, runWithContext } from './request-context'

describe('request-scoped log context', () => {
  // A digest job logged "Digest entry suppressed" with a `reason`, and its next
  // line, "Email provider accepted message", carried that reason too: pino wrote
  // each call's fields into the live span attributes the mixin returned.
  it('keeps one log call’s fields out of the next line of the same job', async () => {
    const lines: Record<string, unknown>[] = []
    const logger = getLogger({
      write: (line: string) => {
        lines.push(JSON.parse(line) as Record<string, unknown>)
      },
    })

    await runWithContext('job-digest-1', async () => {
      enrichSpan({ useCase: 'digest-notification' })
      logger.info(
        { correlationId: 'notification-email:1', reason: 'preference_disabled' },
        'Digest entry suppressed',
      )
      logger.info(
        { providerMessageId: 'stub-email-13' },
        'Email provider accepted message',
      )

      expect(getSpanAttrs()).toEqual({ useCase: 'digest-notification' })
    })

    const accepted = lines.find((line) => line.msg === 'Email provider accepted message')
    expect(accepted).toMatchObject({
      useCase: 'digest-notification',
      providerMessageId: 'stub-email-13',
    })
    expect(accepted).not.toHaveProperty('reason')
    expect(accepted).not.toHaveProperty('correlationId')
  })
})
