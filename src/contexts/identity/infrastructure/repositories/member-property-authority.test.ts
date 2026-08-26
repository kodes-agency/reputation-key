import { describe, expect, it } from 'vitest'
import { propertyAuthorityRequirement } from './member-property-authority'

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
})
