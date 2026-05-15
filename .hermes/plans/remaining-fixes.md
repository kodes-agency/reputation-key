# Remaining Fixes Plan

## Batch 1: API routes — extract server functions

- [ ] api/public/click/$linkId.ts — create `trackLinkClick` server fn in guest context
- [ ] api/portals/$id/qr.ts — create `getPortalQRData` server fn in portal context

## Batch 2: Auth flows — wrap in server functions

- [ ] reset-password.tsx — extract `requestPasswordResetFn` server fn
- [ ] create-organization-dialog.tsx — convert to TanStack Form + server fn

## Batch 3: Upload useServerFn → useAction/useMutationActionSilent

- [ ] profile.tsx — wrap requestUpload/finalizeUpload with useAction
- [ ] organization-settings-page.tsx — wrap upload/switch with useAction
- [ ] $portalSlug.tsx — wrap submitFeedback/submitRating with useAction

## Batch 4: Inline type annotations in routes

- [ ] portals/index.tsx — fix inline (p: { id: string }) type
- [ ] $portalId.tsx — same
- [ ] $teamId.tsx — same
- [ ] people.tsx — fix member map type
- [ ] accept-invitation.tsx — fix filter type
- [ ] \_authenticated.tsx — fix `as Role` cast

## Batch 5: security-settings-form + profile-settings-form — receive mutation as props

- [ ] Extract authClient calls to server fns
- [ ] Pass mutation actions as props from route
