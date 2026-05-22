# Deep Review r11: Multi-tenancy & Tenant Isolation

## Findings

### No BLOCKER issues found

All repository queries on tenant-owned tables include `organizationId` in the WHERE clause. The only unscoped queries are:

1. **System-level queries** (cron jobs) — `findAllExpiringBefore`, `findAllExpiredBefore` in review repo, `deleteAllExpired` in gbp-cache repo — these must scan across all orgs by design.
2. **Public API queries** (unauthenticated guest/portal lookups) — `public-portal-lookup.ts`, `portal-context-resolver.ts`, `link-resolver.repository.ts` — these use unguessable UUIDs as capability tokens.
3. **Webhook handler query** — `findByGbpPlaceId` in property repo — unscoped because it's triggered by Google push notification with no auth context. Tenant context is re-established from the found property.

### [MAJOR] `gbpCache.deleteByProperty` doesn't include `organizationId` in DELETE WHERE clause
- **File:** `src/contexts/integration/infrastructure/repositories/gbp-cache.repository.ts:59`
- **Quote:** `await db.delete(gbpCache).where(eq(gbpCache.propertyId, propertyId))`
- **Rule:** "Any DB query (read or write) on a tenant-owned table without `organizationId` in the predicate"
- **Mitigating factor:** `belongsToOrg` check at line 57 validates the property belongs to the org before deleting
- **Triage:** `relevant` — defense-in-depth: add `organizationId` to WHERE clause
- **Fix:** Add `eq(gbpCache.organizationId, orgId)` to the WHERE clause

### [MAJOR] Guest interaction inserts (`recordScan`, `insertRating`, `insertFeedback`) don't verify `organizationId` against auth context
- **File:** `src/contexts/guest/infrastructure/repositories/guest-interaction.repository.ts:13,19,25`
- **Rule:** These are public-facing guest APIs where `organizationId` comes from the resolved portal context (via capability token), not from auth context
- **Triage:** `wontfix` — by design. Guest submissions are unauthenticated; orgId is derived from the portal lookup.

### Tenant isolation test coverage
- **Property repo tests:** ✅ Use ORG_A and ORG_B fixtures, assert cross-org non-visibility
- **Staff assignment repo tests:** ✅ Use ORG_A and ORG_B fixtures
- **Team repo tests:** ✅ Use ORG_A and ORG_B fixtures
- **Portal repo tests:** ✅ Use ORG_A and ORG_B fixtures
- **Portal link repo tests:** ✅ Use ORG_A and ORG_B fixtures
- **Google connection repo tests:** ✅ Use ORG_A and ORG_B fixtures
- **GBP import repo tests:** ✅ Use ORG_A and ORG_B fixtures
- **GBP cache repo tests:** ✅ Use ORG_A and ORG_B fixtures
- **Inbox repo tests:** Uses in-memory store with orgId filtering
- **Reply repo tests:** In-memory, scoped
- **Review repo tests:** In-memory, scoped
- **Dashboard repo:** Scopes by orgId in queries

## Summary

- **BLOCKER:** 0
- **MAJOR:** 1 (defense-in-depth: gbpCache.deleteByProperty missing orgId in WHERE)
- **Most important fix:** Add `organizationId` to `deleteByProperty` WHERE clause

## Tenant scoping table

| Entity | Table | Tenant column | Unscoped queries |
|--------|-------|---------------|-----------------|
| Property | properties | organizationId | findByGbpPlaceId (webhook, by design) |
| Portal | portals | organizationId | public lookups (capability token, by design) |
| PortalLink | portal_links | organizationId | public lookups (capability token, by design) |
| PortalLinkCategory | portal_link_categories | organizationId | none |
| Team | teams | organizationId | none |
| StaffAssignment | staff_assignments | organizationId | none |
| Review | reviews | organizationId | findAllExpiringBefore/Expired (system, by design) |
| Reply | replies | organizationId | none |
| InboxItem | inbox_items | organizationId | none |
| InboxNote | inbox_notes | organizationId | none |
| MetricReading | metric_readings | organizationId | none |
| GoogleConnection | google_connections | organizationId | none |
| GbpImportJob | gbp_import_jobs | organizationId | none |
| GbpCache | gbp_cache | organizationId | deleteByProperty (needs fix) |
| GuestRating | ratings | organizationId | none (public API) |
| GuestFeedback | feedback | organizationId | none (public API) |
| ScanEvent | scan_events | organizationId | none (public API) |

## Plan

1. Add `eq(gbpCache.organizationId, orgId)` to `deleteByProperty` WHERE clause in gbp-cache.repository.ts
2. Verify with `npx tsc --noEmit`
