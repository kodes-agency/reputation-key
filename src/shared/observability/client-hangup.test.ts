import { describe, expect, it } from 'vitest'
import {
  INCOMING_ABORT_STACK,
  incomingRequestAbort,
  outboundSocketReset,
  resetError,
  responseCutByServer,
} from '#/shared/testing/client-hangup-fixtures'
import { dropClientHangups, isIncomingRequestAbort } from './client-hangup'

describe('isIncomingRequestAbort', () => {
  it('recognises the visitor closing the connection while the server answers', () => {
    expect(isIncomingRequestAbort(incomingRequestAbort())).toBe(true)
  })

  it.each([
    ['a response this process was reading, cut by the server', responseCutByServer],
    ['a Postgres or Redis socket reset', outboundSocketReset],
    [
      'an outbound request whose socket hung up',
      () =>
        resetError(
          'socket hang up',
          'Error: socket hang up\n    at Socket.socketOnEnd (node:_http_client:542:25)',
        ),
    ],
    [
      'a failed outbound fetch that carries a reset as its cause',
      () =>
        Object.assign(new TypeError('fetch failed'), { cause: incomingRequestAbort() }),
    ],
    [
      'the same words with another code',
      () =>
        Object.assign(new Error('aborted'), {
          code: 'EPIPE',
          stack: INCOMING_ABORT_STACK,
        }),
    ],
    [
      'the same words with no code',
      () => Object.assign(new Error('aborted'), { stack: INCOMING_ABORT_STACK }),
    ],
    [
      'the same shape with a syscall',
      () => resetError('aborted', INCOMING_ABORT_STACK, { syscall: 'read' }),
    ],
    ['a reset whose stack is gone', () => resetError('aborted', '')],
  ])('keeps reporting %s', (_label, make) => {
    expect(isIncomingRequestAbort(make())).toBe(false)
  })

  it.each([undefined, null, 'aborted', 42, {}])(
    'ignores a non-error value (%s)',
    (value) => {
      expect(isIncomingRequestAbort(value)).toBe(false)
    },
  )
})

describe('dropClientHangups', () => {
  const deliver = dropClientHangups((event: { id: string }) => ({ ...event, sent: true }))

  it('drops the hang-up before the scrubber sees it', () => {
    expect(deliver({ id: 'a' }, { originalException: incomingRequestAbort() })).toBeNull()
  })

  it.each([
    ['an outbound reset', outboundSocketReset()],
    ['another error', new Error('database failed')],
    ['no exception', undefined],
  ])('hands %s on', (_label, exception) => {
    expect(
      deliver(
        { id: 'a' },
        exception === undefined ? undefined : { originalException: exception },
      ),
    ).toEqual({ id: 'a', sent: true })
  })
})
