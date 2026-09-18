import { describe, expect, it } from 'vitest'
import {
  issueUrlFor,
  reporterFeedbackStatus,
  reporterRouteLabel,
} from './beta-feedback-status'

describe('reporter feedback status', () => {
  it('reports a send failure rather than a triage state', () => {
    const status = reporterFeedbackStatus({
      deliveryState: 'failed',
      triageState: 'new',
    })

    expect(status.label).toBe('Not sent')
    expect(status.tone).toBe('failed')
  })

  it('treats an undelivered report as still sending', () => {
    expect(
      reporterFeedbackStatus({ deliveryState: 'prepared', triageState: 'new' }).label,
    ).toBe('Sending')
  })

  it.each([
    ['new', 'Received'],
    ['screened', 'Read'],
    ['reproducing', 'Being investigated'],
    ['accepted', 'Accepted'],
    ['declined', 'Not planned'],
    ['resolved', 'Resolved'],
  ] as const)('describes %s to the reporter as %s', (triageState, label) => {
    expect(
      reporterFeedbackStatus({ deliveryState: 'delivered', triageState }).label,
    ).toBe(label)
  })

  it('never exposes internal triage vocabulary to the reporter', () => {
    const leaks = ['security', 'privacy', 'severity', 'P0', 'P1', 'dedupe', 'duplicate']
    const states = [
      'new',
      'screened',
      'reproducing',
      'accepted',
      'declined',
      'resolved',
    ] as const

    for (const triageState of states) {
      const status = reporterFeedbackStatus({ deliveryState: 'delivered', triageState })
      const text = `${status.label} ${status.description}`.toLowerCase()
      for (const leak of leaks) expect(text).not.toContain(leak.toLowerCase())
    }
  })
})

describe('reporter route label', () => {
  it.each([
    ['inbox', 'Inbox'],
    ['properties.property.reviews', 'Properties · Property · Reviews'],
    ['settings.ai', 'Settings · Ai'],
    ['properties.import.detail', 'Properties · Import · Detail'],
    ['other_authenticated', 'Elsewhere in RepKey'],
  ])('renders %s as %s', (routeKey, expected) => {
    expect(reporterRouteLabel(routeKey)).toBe(expected)
  })
})

describe('issue url', () => {
  it('links a plain issue number to the public tracker', () => {
    expect(issueUrlFor('472')).toBe(
      'https://github.com/kodes-agency/reputation-key/issues/472',
    )
  })

  it.each([
    ['a hand-recorded reference', 'JIRA-12'],
    ['a path that could escape the tracker', '472/../../evil'],
    ['an absolute URL', 'https://example.invalid/472'],
    ['a number with trailing text', '472x'],
    ['an empty string', ''],
  ])('leaves %s as text rather than guessing a URL', (_label, reference) => {
    expect(issueUrlFor(reference)).toBeNull()
  })
})
