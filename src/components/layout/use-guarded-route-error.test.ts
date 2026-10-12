// The router's default error boundary has four jobs, and a route that renders
// its own error component used to skip all of them: it printed the raw message
// in production, never reported the failure, showed "could not be loaded" to a
// person whose session had simply expired, and offered no way to retry. They
// are decided here once, as pure facts about the error, so each can be asserted
// without a router.
import { describe, expect, it } from 'vitest'
import { GENERIC_CLIENT_ERROR_MESSAGE } from '#/shared/security/error-display'
import { routeErrorFacts } from './use-guarded-route-error'

const withStatus = (status: number, message = 'refused'): Error =>
  Object.assign(new Error(message), { status })

describe('routeErrorFacts', () => {
  describe('message', () => {
    const leaky = new Error('duplicate key value violates "users_email_unique"')

    it('never shows the raw message in production', () => {
      const { message } = routeErrorFacts(leaky, true)
      expect(message).toBe(GENERIC_CLIENT_ERROR_MESSAGE)
      expect(message).not.toContain('users_email_unique')
    })

    it('shows the page-specific sentence in production when the page gave one', () => {
      expect(routeErrorFacts(leaky, true, 'Portals could not be loaded.').message).toBe(
        'Portals could not be loaded.',
      )
    })

    it('keeps the raw message for development', () => {
      expect(routeErrorFacts(new Error('dev detail'), false).message).toBe('dev detail')
    })
  })

  describe('signedOut', () => {
    it('is true for a 401, which means the session ended under an open page', () => {
      expect(routeErrorFacts(withStatus(401), true).signedOut).toBe(true)
    })

    it('reads the status h3 sets as statusCode as well', () => {
      const error = Object.assign(new Error('expired'), { statusCode: 401 })
      expect(routeErrorFacts(error, true).signedOut).toBe(true)
    })

    it.each([403, 404, 500])('is false for a %i', (status) => {
      expect(routeErrorFacts(withStatus(status), true).signedOut).toBe(false)
    })

    it('is false for an error with no status', () => {
      expect(routeErrorFacts(new Error('boom'), true).signedOut).toBe(false)
    })
  })

  describe('report', () => {
    it('reports an error with no status', () => {
      expect(routeErrorFacts(new Error('boom'), true).report).toBe(true)
    })

    it('reports a server failure', () => {
      expect(routeErrorFacts(withStatus(500), true).report).toBe(true)
    })

    it.each([400, 401, 403, 404])('does not report an expected %i refusal', (status) => {
      expect(routeErrorFacts(withStatus(status), true).report).toBe(false)
    })

    it('reports a thrown string', () => {
      expect(routeErrorFacts('boom', true).report).toBe(true)
    })
  })
})
