import { describe, expect, it } from 'vitest'
import { renderNotification } from './notification-templates'

// A reauth_required connection admits no sync, reply or import (integration
// invariant 15), so every version of this notice must say work has stopped;
// copy that implies it still runs lets an admin put the reconnect off.
describe('integration.reauthorization_required copy', () => {
  it.each(['member_removed', 'account_admin_role_lost'] as const)(
    'says updates and replies are paused when the connector left (%s)',
    (reauthorizationCause) => {
      const rendered = renderNotification('integration.reauthorization_required', {
        reauthorizationCause,
      })
      expect(rendered.body).toBe(
        'The person who connected Google is no longer an account admin here, so review updates and replies are paused. Reconnect Google to restart them.',
      )
      expect(rendered.body).not.toMatch(/keep .* working/)
    },
  )

  it('says work is paused when an older notice carries no cause', () => {
    expect(renderNotification('integration.reauthorization_required', {}).body).toBe(
      'Review updates and replies are paused until Google is reconnected.',
    )
  })
})
