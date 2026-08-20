import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  emailCorrelationId,
  providerEventCorrelationId,
} from './delivery-correlation'

describe('delivery correlation ids', () => {
  it('builds the queue row log identity', () => {
    expect(emailCorrelationId('email-1')).toBe('notification-email:email-1')
    expect(providerEventCorrelationId('msg_2abc')).toBe('resend-event:msg_2abc')
  })

  it('matches the correlationId the job envelopes already stamp', () => {
    // If these drift, the enqueue log and the delivery log stop joining, which
    // is exactly the invisible-failure problem this pipeline exists to fix.
    const bootstrap = readFileSync('src/bootstrap.ts', 'utf-8')
    const build = readFileSync('src/contexts/notification/build.ts', 'utf-8')
    const envelopeShape = 'notification-email:${'

    expect(bootstrap).toContain(envelopeShape)
    expect(build).toContain(envelopeShape)
    expect(emailCorrelationId('X')).toBe('notification-email:X')
  })
})
