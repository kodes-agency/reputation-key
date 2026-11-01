// The usual private-rating Portals and the independent direct-Google journey.

export type PortalFixture = Readonly<{
  id: string
  tokenId: string
  snapshotId: string
  activationId: string
  name: string
  slug: string
  tokenByte: number
  skipPrivateRating?: boolean
}>

export const E2E_PORTAL_IDS = {
  p1Portal: '11111111-1111-4111-9111-111111111111',
  p2Portal: '22222222-2222-4222-9222-222222222222',
  p3Portal: '33333333-3333-4333-9333-333333333333',
  p1PortalToken: '11111111-1111-4111-a111-111111111111',
  p2PortalToken: '22222222-2222-4222-a222-222222222222',
  p3PortalToken: '33333333-3333-4333-a333-333333333333',
} as const

export const P1_PORTAL_FIXTURE: PortalFixture = {
  id: E2E_PORTAL_IDS.p1Portal,
  tokenId: E2E_PORTAL_IDS.p1PortalToken,
  snapshotId: '11111111-1111-4111-a111-111111111111',
  activationId: '11111111-1111-4111-b111-111111111111',
  name: 'E2E Guest Portal P1',
  slug: 'e2e-guest-portal-p1',
  tokenByte: 0x11,
}

export const P2_PORTAL_FIXTURE: PortalFixture = {
  id: E2E_PORTAL_IDS.p2Portal,
  tokenId: E2E_PORTAL_IDS.p2PortalToken,
  snapshotId: '22222222-2222-4222-a222-222222222222',
  activationId: '22222222-2222-4222-b222-222222222222',
  name: 'E2E Guest Portal P2',
  slug: 'e2e-guest-portal-p2',
  tokenByte: 0x22,
}

export const P3_PORTAL_FIXTURE: PortalFixture = {
  id: E2E_PORTAL_IDS.p3Portal,
  tokenId: E2E_PORTAL_IDS.p3PortalToken,
  snapshotId: '33333333-3333-4333-a333-333333333333',
  activationId: '33333333-3333-4333-b333-333333333333',
  name: 'E2E Guest Portal P3',
  slug: 'e2e-guest-portal-p3',
  tokenByte: 0x33,
}

export const DIRECT_PORTAL_FIXTURE: PortalFixture = {
  id: '44444444-4444-4444-8444-444444444441',
  tokenId: '44444444-4444-4444-8444-444444444442',
  snapshotId: '44444444-4444-4444-a444-444444444444',
  activationId: '44444444-4444-4444-b444-444444444444',
  name: 'E2E Direct Google Portal',
  slug: 'e2e-direct-google',
  tokenByte: 0x44,
  skipPrivateRating: true,
}
