// Identity context — domain rules tests
// Per architecture: "Domain tests are pure unit tests, no setup, run in milliseconds."
// Per Phase 3 gate: "Permission functions in domain layer have 100% test coverage"

import { describe, it, expect } from 'vitest'
import {
  validateSlug,
  validateOrganizationName,
  canInviteWithRole,
  canChangeRole,
  normalizeSlug,
} from './rules'

// ── validateSlug ────────────────────────────────────────────────────

describe('validateSlug', () => {
  it('accepts valid slugs', () => {
    expect(validateSlug('my-org')._unsafeUnwrap()).toBe('my-org')
    expect(validateSlug('abc')._unsafeUnwrap()).toBe('abc')
    expect(validateSlug('a1')._unsafeUnwrap()).toBe('a1')
    expect(validateSlug('my-awesome-org-2025')._unsafeUnwrap()).toBe(
      'my-awesome-org-2025',
    )
  })

  it('rejects slugs shorter than 2 characters', () => {
    const result = validateSlug('a')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_slug')
    }
  })

  it('rejects empty slugs', () => {
    const result = validateSlug('')
    expect(result.isErr()).toBe(true)
  })

  it('rejects slugs longer than 63 characters', () => {
    const longSlug = 'a'.repeat(64)
    const result = validateSlug(longSlug)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_slug')
    }
  })

  it('rejects slugs starting with a hyphen', () => {
    const result = validateSlug('-my-org')
    expect(result.isErr()).toBe(true)
  })

  it('rejects slugs ending with a hyphen', () => {
    const result = validateSlug('my-org-')
    expect(result.isErr()).toBe(true)
  })

  it('rejects slugs with uppercase letters', () => {
    const result = validateSlug('My-Org')
    expect(result.isErr()).toBe(true)
  })

  it('rejects slugs with spaces', () => {
    const result = validateSlug('my org')
    expect(result.isErr()).toBe(true)
  })

  it('trims whitespace before validation', () => {
    const result = validateSlug('  my-org  ')
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value).toBe('my-org')
    }
  })
})

// ── validateOrganizationName ────────────────────────────────────────

describe('validateOrganizationName', () => {
  it('accepts valid names', () => {
    expect(validateOrganizationName('My Org')._unsafeUnwrap()).toBe('My Org')
    expect(validateOrganizationName('Acme Corp')._unsafeUnwrap()).toBe('Acme Corp')
  })

  it('rejects names shorter than 2 characters', () => {
    const result = validateOrganizationName('A')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_name')
    }
  })

  it('rejects empty names', () => {
    const result = validateOrganizationName('')
    expect(result.isErr()).toBe(true)
  })

  it('rejects names longer than 100 characters', () => {
    const longName = 'A'.repeat(101)
    const result = validateOrganizationName(longName)
    expect(result.isErr()).toBe(true)
  })

  it('trims whitespace', () => {
    const result = validateOrganizationName('  My Org  ')
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value).toBe('My Org')
    }
  })
})

// ── canInviteWithRole ────────────────────────────────────────────────

describe('canInviteWithRole', () => {
  it('allows AccountAdmin to invite with any role', () => {
    expect(canInviteWithRole('AccountAdmin', 'Staff')._unsafeUnwrap()).toBe(true)
    expect(canInviteWithRole('AccountAdmin', 'PropertyManager')._unsafeUnwrap()).toBe(
      true,
    )
    expect(canInviteWithRole('AccountAdmin', 'AccountAdmin')._unsafeUnwrap()).toBe(true)
  })

  it('allows PropertyManager to invite Staff and PropertyManager', () => {
    expect(canInviteWithRole('PropertyManager', 'Staff')._unsafeUnwrap()).toBe(true)
    expect(canInviteWithRole('PropertyManager', 'PropertyManager')._unsafeUnwrap()).toBe(
      true,
    )
  })

  it('prevents PropertyManager from inviting AccountAdmin', () => {
    const result = canInviteWithRole('PropertyManager', 'AccountAdmin')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('forbidden')
    }
  })

  it('prevents Staff from inviting anyone', () => {
    expect(canInviteWithRole('Staff', 'Staff').isErr()).toBe(true)
    expect(canInviteWithRole('Staff', 'PropertyManager').isErr()).toBe(true)
    expect(canInviteWithRole('Staff', 'AccountAdmin').isErr()).toBe(true)
  })
})

// ── normalizeSlug ────────────────────────────────────────────────────

describe('normalizeSlug', () => {
  it('lowercases and replaces non-alphanumeric with hyphens', () => {
    expect(normalizeSlug('Hello World')).toBe('hello-world')
  })

  it('strips special characters', () => {
    expect(normalizeSlug("O'Brien's Pub!")).toBe('obriens-pub')
  })

  it('collapses consecutive hyphens', () => {
    expect(normalizeSlug('a  b   c')).toBe('a-b-c')
  })

  it('trims leading and trailing hyphens', () => {
    expect(normalizeSlug('-hello-')).toBe('hello')
  })

  it('trims whitespace', () => {
    expect(normalizeSlug('  My Org  ')).toBe('my-org')
  })

  it('caps at 63 characters', () => {
    expect(normalizeSlug('a'.repeat(100)).length).toBe(63)
  })

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeSlug('   ')).toBe('')
  })
})

// ── canChangeRole ────────────────────────────────────────────────────

describe('canChangeRole', () => {
  it('allows AccountAdmin to change Staff to PropertyManager', () => {
    expect(
      canChangeRole('AccountAdmin', 'Staff', 'PropertyManager')._unsafeUnwrap(),
    ).toBe(true)
  })

  it('allows AccountAdmin to change Staff to AccountAdmin', () => {
    expect(canChangeRole('AccountAdmin', 'Staff', 'AccountAdmin')._unsafeUnwrap()).toBe(
      true,
    )
  })

  it('allows PropertyManager to change Staff role', () => {
    expect(canChangeRole('PropertyManager', 'Staff', 'Staff')._unsafeUnwrap()).toBe(true)
  })

  it('prevents PropertyManager from changing PropertyManager role', () => {
    const result = canChangeRole('PropertyManager', 'PropertyManager', 'Staff')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('forbidden')
    }
  })

  it('prevents PropertyManager from assigning AccountAdmin role', () => {
    const result = canChangeRole('PropertyManager', 'Staff', 'AccountAdmin')
    expect(result.isErr()).toBe(true)
  })

  it('prevents Staff from changing any role', () => {
    expect(canChangeRole('Staff', 'Staff', 'PropertyManager').isErr()).toBe(true)
    expect(canChangeRole('Staff', 'PropertyManager', 'Staff').isErr()).toBe(true)
  })

  it('prevents changing AccountAdmin role (even by AccountAdmin — equal role)', () => {
    const result = canChangeRole('AccountAdmin', 'AccountAdmin', 'PropertyManager')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('forbidden')
    }
  })
})
