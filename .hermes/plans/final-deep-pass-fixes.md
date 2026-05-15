# Final Deep Pass — Fix Plan

## Batch A: Missing invalidateRoutes (HIGH — stale UI bugs)

- [ ] A1. people.tsx — add invalidateRoutes to 4 mutations
- [ ] A2. teams/$teamId/index.tsx — add invalidateRoutes to updateTeam
- [ ] A3. teams/$teamId/members.tsx — add invalidateRoutes to 2 mutations
- [ ] A4. portals/$portalId.tsx — add invalidateRoutes to updatePortal
- [ ] A5. portals/new.tsx — replace router.invalidate() with invalidateRoutes

## Batch B: Conditional hook calls (HIGH — React Rules of Hooks violation)

- [ ] B1. feedback-form.tsx — fix conditional useAction
- [ ] B2. star-rating.tsx — fix conditional useAction

## Batch C: Error swallowing in loaders (HIGH)

- [ ] C1. $portalSlug.tsx — remove try/catch, let errors propagate
- [ ] C2. \_authenticated.tsx loader — use Promise.all instead of Promise.allSettled

## Batch D: Duplicate types + mutable props (MEDIUM)

- [ ] D1. Extract UpdatePortalVariables, PortalData, FormLike to portal shared types
- [ ] D2. Fix PortalCategory[]/PortalLinkItem[] → ReadonlyArray in preview components
- [ ] D3. Extract PropertyOption to member-directory shared types
- [ ] D4. Fix basic-info-section + portal-name-slug-group to use shared FormWithField

## Batch E: Component fixes (MEDIUM)

- [ ] E1. feedback-form.tsx — fix unsafe `(result as { blocked?: boolean })` cast
- [ ] E2. portal-settings.tsx — fix updatePortal missing invalidateRoutes
- [ ] E3. \_authenticated.tsx beforeLoad — re-throw non-redirect errors

## Batch F: LOW items

- [ ] F1. Deep imports → use barrels (settings routes, profile, security)
- [ ] F2. Inline type annotations in route .find()/.filter() calls
