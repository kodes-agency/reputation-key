import { describe, expect, it } from 'vitest'
import {
  managerPropertyAuthorityRequirement,
  propertyAuthorityRequirement,
} from './member-property-authority'

describe('member Property authority', () => {
  it('denies a privileged raw label when current effective permissions deny it', () => {
    expect(
      propertyAuthorityRequirement(
        {
          role: 'AccountAdmin',
          effectivePermissions: new Set(),
          scopeByPermission: new Map(),
        },
        'ai.manage',
      ),
    ).toBe('deny')
  })

  it('uses current permission scope independently of the raw role label', () => {
    expect(
      propertyAuthorityRequirement(
        {
          role: 'Staff',
          effectivePermissions: new Set(['ai.manage']),
          scopeByPermission: new Map([['ai.manage', 'organization']]),
        },
        'ai.manage',
      ),
    ).toBe('organization')
    expect(
      propertyAuthorityRequirement(
        {
          role: 'AccountAdmin',
          effectivePermissions: new Set(['ai.manage']),
          scopeByPermission: new Map([['ai.manage', 'assigned-properties']]),
        },
        'ai.manage',
      ),
    ).toBe('active-grant')
  })

  it('requires one Property grant when any required permission is assigned-scoped', () => {
    expect(
      managerPropertyAuthorityRequirement(
        {
          role: 'PropertyManager',
          effectivePermissions: new Set(['inbox.read', 'inbox.write']),
          scopeByPermission: new Map([
            ['inbox.read', 'organization'],
            ['inbox.write', 'assigned-properties'],
          ]),
        },
        ['inbox.read', 'inbox.write'],
      ),
    ).toBe('active-grant')
  })

  it('denies the whole decision when any required permission is absent', () => {
    expect(
      managerPropertyAuthorityRequirement(
        {
          role: 'AccountAdmin',
          effectivePermissions: new Set(['inbox.read']),
          scopeByPermission: new Map([['inbox.read', 'organization']]),
        },
        ['inbox.read', 'inbox.write'],
      ),
    ).toBe('deny')
  })

  it('fails closed when a caller supplies no required permission', () => {
    expect(
      managerPropertyAuthorityRequirement(
        {
          role: 'AccountAdmin',
          effectivePermissions: new Set(['inbox.read']),
          scopeByPermission: new Map([['inbox.read', 'organization']]),
        },
        [],
      ),
    ).toBe('deny')
  })
})
