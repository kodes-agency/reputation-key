// Integration context — domain rules tests
// Per architecture: "Pure unit, no setup, no mocks. Run in milliseconds."

import { describe, it, expect } from 'vitest'
import { isGovernedDisconnectInFlight, isValidVisibility } from './rules'

// ── isValidVisibility ─────────────────────────────────────────────

describe('isValidVisibility', () => {
  it('accepts "private"', () => {
    expect(isValidVisibility('private')).toBe(true)
  })

  it('accepts "organization"', () => {
    expect(isValidVisibility('organization')).toBe(true)
  })

  it('rejects "public"', () => {
    expect(isValidVisibility('public')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidVisibility('')).toBe(false)
  })

  it('rejects uppercase', () => {
    expect(isValidVisibility('Private')).toBe(false)
  })

  it('rejects "PRIVATE"', () => {
    expect(isValidVisibility('PRIVATE')).toBe(false)
  })

  it('rejects whitespace-padded value', () => {
    expect(isValidVisibility(' private ')).toBe(false)
  })

  it('narrows type on truthy return', () => {
    const value = 'private' as string
    if (isValidVisibility(value)) {
      // TypeScript narrows to GoogleConnectionVisibility here
      const _assigned: 'private' | 'organization' = value
      expect(_assigned).toBe('private')
    }
  })
})

// ── isGovernedDisconnectInFlight ──────────────────────────────────

describe('isGovernedDisconnectInFlight', () => {
  const NOW = new Date('2026-06-01T12:00:00.000Z')
  const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs)

  it('holds a disconnecting connection while its cleanup window is open', () => {
    expect(
      isGovernedDisconnectInFlight(
        { status: 'disconnecting', cleanupMaterialDeadlineAt: at(1) },
        NOW,
      ),
    ).toBe(true)
  })

  it.each([
    ['closes at', at(0)],
    ['has passed', at(-1)],
  ])(
    'releases a disconnecting connection whose window %s the deadline',
    (_, deadline) => {
      expect(
        isGovernedDisconnectInFlight(
          { status: 'disconnecting', cleanupMaterialDeadlineAt: deadline },
          NOW,
        ),
      ).toBe(false)
    },
  )

  it('releases a disconnecting connection that carries no cleanup deadline', () => {
    expect(
      isGovernedDisconnectInFlight(
        { status: 'disconnecting', cleanupMaterialDeadlineAt: null },
        NOW,
      ),
    ).toBe(false)
  })

  it.each(['active', 'reauth_required', 'disconnected'] as const)(
    'never holds a %s connection, whatever its deadline',
    (status) => {
      expect(
        isGovernedDisconnectInFlight(
          { status, cleanupMaterialDeadlineAt: at(60_000) },
          NOW,
        ),
      ).toBe(false)
    },
  )
})
