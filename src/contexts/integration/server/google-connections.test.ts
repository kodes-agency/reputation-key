// Integration context — Google connection boundary tests.
// Tests input validation for the remaining Google connection server functions,
// the callback-only connect command, and IntegrationError translation.
//
// Per architecture: server functions are thin wrappers — resolve auth →
// validate input → call use case → translate errors → return.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { z } from 'zod/v4'
import { integrationErrorStatus } from './error-helpers'
import { integrationError } from '../domain/errors'
import type { IntegrationErrorCode } from '../domain/errors'
import { throwContextError } from '#/shared/auth/server-errors'
import { connectGoogleInputSchema } from '../application/dto/connect-google.dto'
import { disconnectGoogleInputSchema } from '../application/dto/disconnect-google.dto'
import { updateConnectionVisibilityInputSchema } from '../application/dto/update-connection-visibility.dto'

describe('Google OAuth server boundary', () => {
  it('does not expose a server function that accepts PKCE verifier material', () => {
    const source = readFileSync(
      'src/contexts/integration/server/google-connections.ts',
      'utf8',
    )

    expect(source).not.toMatch(/export const connectGoogle\s*=/)
    expect(source).not.toMatch(/\bconnectGoogleInputSchema\b/)
    expect(source).not.toContain('verifierMaterial')
  })
})

// ── throwContextError with IntegrationError ───────────────────────

describe('throwContextError with IntegrationError (google-connections handlers)', () => {
  it('throws an Error with the domain message', () => {
    const e = integrationError('oauth_failed', 'OAuth flow failed')
    expect(() =>
      throwContextError('IntegrationError', e, integrationErrorStatus(e.code)),
    ).toThrow('OAuth flow failed')
  })

  it('sets error.name to IntegrationError', () => {
    const e = integrationError('forbidden', 'Insufficient role')
    try {
      throwContextError('IntegrationError', e, integrationErrorStatus(e.code))
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).name).toBe('IntegrationError')
    }
  })

  it('attaches code and status as custom properties', () => {
    const e = integrationError('connection_not_found', 'Not found')
    try {
      throwContextError('IntegrationError', e, integrationErrorStatus(e.code))
    } catch (err) {
      const error = err as Error & { code: string; status: number }
      expect(error.code).toBe('connection_not_found')
      expect(error.status).toBe(404)
    }
  })

  it('preserves the correct status for every error code', () => {
    const cases: Array<[IntegrationErrorCode, number]> = [
      ['forbidden', 403],
      ['connection_not_found', 404],
      ['import_not_found', 404],
      ['oauth_failed', 400],
      ['oauth_denied', 400],
      ['oauth_state_invalid', 400],
      ['token_refresh_failed', 400],
      ['gbp_api_error', 400],
      ['invalid_visibility', 400],
      ['encryption_error', 400],
      ['gbp_api_rate_limited', 429],
      ['connection_disconnected', 409],
    ]
    for (const [code, expectedStatus] of cases) {
      const e = integrationError(code, `test ${code}`)
      try {
        throwContextError('IntegrationError', e, integrationErrorStatus(e.code))
      } catch (err) {
        const error = err as Error & { code: string; status: number }
        expect(error.status).toBe(expectedStatus)
        expect(error.code).toBe(code)
      }
    }
  })
})

// ── getAuthUrl input validation (inline schema) ───────────────────

const getAuthUrlInputSchema = z.object({
  visibility: z.enum(['private', 'organization']).default('private'),
})

describe('getAuthUrlInputSchema', () => {
  it('accepts valid visibility "private"', () => {
    const result = getAuthUrlInputSchema.safeParse({ visibility: 'private' })
    expect(result.success).toBe(true)
  })

  it('accepts valid visibility "organization"', () => {
    const result = getAuthUrlInputSchema.safeParse({ visibility: 'organization' })
    expect(result.success).toBe(true)
  })

  it('defaults visibility to "private" when omitted', () => {
    const result = getAuthUrlInputSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.visibility).toBe('private')
    }
  })

  it('rejects invalid visibility value', () => {
    const result = getAuthUrlInputSchema.safeParse({ visibility: 'public' })
    expect(result.success).toBe(false)
  })
})

// ── callback-only connect command validation ─────────────────────

const validConnectInput = () => ({
  code: 'auth-code-123',
  purpose: 'reviews' as const,
  connectionMode: 'new' as const,
  targetConnectionId: null,
  verifierMaterial: {
    contractVersion: 'v2' as const,
    codeVerifier: 'v'.repeat(43),
    oidcNonce: 'n'.repeat(43),
  },
})

describe('opaque OAuth callback connect input', () => {
  it('accepts valid input with code and visibility', () => {
    const result = connectGoogleInputSchema.safeParse({
      ...validConnectInput(),
      visibility: 'organization',
    })
    expect(result.success).toBe(true)
  })

  it('defaults visibility to private', () => {
    const result = connectGoogleInputSchema.safeParse(validConnectInput())
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.visibility).toBe('private')
    }
  })

  it('rejects missing verifier material', () => {
    const { verifierMaterial: _, ...input } = validConnectInput()
    expect(connectGoogleInputSchema.safeParse(input).success).toBe(false)
  })

  it('rejects missing code', () => {
    const { code: _, ...input } = validConnectInput()
    expect(connectGoogleInputSchema.safeParse(input).success).toBe(false)
  })

  it('rejects empty code', () => {
    const result = connectGoogleInputSchema.safeParse({
      ...validConnectInput(),
      code: '',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid visibility value', () => {
    const result = connectGoogleInputSchema.safeParse({
      ...validConnectInput(),
      visibility: 'public',
    })
    expect(result.success).toBe(false)
  })
})

// ── disconnectGoogle input validation ─────────────────────────────

describe('disconnectGoogleInputSchema', () => {
  it('accepts valid input', () => {
    const result = disconnectGoogleInputSchema.safeParse({
      connectionId: 'conn-123',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing connectionId', () => {
    const result = disconnectGoogleInputSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects empty connectionId', () => {
    const result = disconnectGoogleInputSchema.safeParse({
      connectionId: '',
    })
    expect(result.success).toBe(false)
  })
})

// ── updateConnectionVisibility input validation ───────────────────

describe('updateConnectionVisibilityInputSchema', () => {
  it('accepts valid input with visibility "private"', () => {
    const result = updateConnectionVisibilityInputSchema.safeParse({
      connectionId: 'conn-123',
      visibility: 'private',
    })
    expect(result.success).toBe(true)
  })

  it('accepts valid input with visibility "organization"', () => {
    const result = updateConnectionVisibilityInputSchema.safeParse({
      connectionId: 'conn-123',
      visibility: 'organization',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing connectionId', () => {
    const result = updateConnectionVisibilityInputSchema.safeParse({
      visibility: 'private',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty connectionId', () => {
    const result = updateConnectionVisibilityInputSchema.safeParse({
      connectionId: '',
      visibility: 'private',
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing visibility', () => {
    const result = updateConnectionVisibilityInputSchema.safeParse({
      connectionId: 'conn-123',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid visibility value', () => {
    const result = updateConnectionVisibilityInputSchema.safeParse({
      connectionId: 'conn-123',
      visibility: 'public',
    })
    expect(result.success).toBe(false)
  })
})
