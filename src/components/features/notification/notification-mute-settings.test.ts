// The mute toast's "Settings" is how a mistaken mute is undone. Settings with
// no Property opens the first one, where the switch the reader just turned off
// elsewhere is still on: they see nothing muted and leave it muted.

import { describe, expect, it, vi } from 'vitest'
import { muteSettingsAction } from './notification-mutations'

const SEASIDE = '33333333-3333-4333-8333-333333333399'

describe('the mute confirmation', () => {
  it("opens the muted Property's own settings", () => {
    const navigate = vi.fn()
    muteSettingsAction(navigate as never, SEASIDE).onClick()
    expect(navigate).toHaveBeenCalledWith({
      to: '/settings/notifications',
      search: { propertyId: SEASIDE },
    })
  })
})
