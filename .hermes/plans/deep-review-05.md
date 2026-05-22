# Deep Review #5 — Infrastructure Adapters Fix Plan

## Scope
Fix 3 true BLOCKERs + 2 MAJORs + 1 MINOR. Defer retry/backoff to later phase.

## Tasks

### B1: Inject config into token-encryption adapter
- Change `createTokenEncryptionAdapter()` to accept `encryptionKey: string`
- Move `getEnv().ENCRYPTION_KEY` call to build.ts

### B2: Inject config into google-oauth adapter
- Change `createGoogleOAuthAdapter()` to accept `{ clientId, clientSecret }`
- Move `getEnv()` calls to build.ts

### B3: Inject config into S3 storage adapter
- Change `createS3StorageAdapter()` to accept config object
- Move `getEnv()` calls to build.ts

### B4-B6: Add security doc comments to public resolvers
- link-resolver.repository.ts — add comment explaining no orgId (public capability-token)
- portal-context-resolver.ts — same
- public-portal-lookup.ts — same

### M2: Cache getAuth() in auth-identity adapter factory
- Call `getAuth()` once in factory, store reference

### m1: Rename createAuthIdentityAdapter → createBetterAuthIdentityAdapter
- Rename function + all callers

### Deferred:
- GBP/OAuth retry policy — needs shared utility first
