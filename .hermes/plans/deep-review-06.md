# Deep Review r06 — Server Functions

## Findings

### 1. [BLOCKER] `getSession` and `ensureActiveOrg` not wrapped in `tracedHandler`
- File: `src/shared/auth/auth.functions.ts:12,19`
- Rule: Server function required shape step 1 — "Wrapped in `tracedHandler()`"
- Fix: Wrap both handlers in `tracedHandler()`

### 2. [BLOCKER] `getSession` and `ensureActiveOrg` have no error handling
- File: `src/shared/auth/auth.functions.ts:12-16,19-44`
- Rule: Server function required shape step 7 — "Errors translated to a stable error envelope"
- Fix: Add try/catch with `throwContextError` / `catchUntagged`

### 3. [BLOCKER] `getDashboardDataFn` has no error handling
- File: `src/contexts/dashboard/server/dashboard.ts:24-45`
- Rule: Server function required shape step 7 — "Errors translated to a stable error envelope"
- Fix: Add try/catch with domain error mapping

### 4. [BLOCKER] `resolveLinkAndTrack` has no error handling
- File: `src/contexts/guest/server/public.ts:191-202`
- Rule: Server function required shape step 7 — "Errors translated to a stable error envelope"
- Fix: Add try/catch with `isGuestError` check

### 5. [MAJOR] `requestUploadUrl` and `finalizeUpload` swallow non-domain errors
- File: `src/contexts/portal/server/portals.ts:206-210,231-235`
- Rule: Server function required shape step 7 — "Catching and returning raw error messages to the client (leak risk)"
- Quote:
  ```typescript
  } catch (e) {
    if (isPortalError(e))
      throwContextError('PortalError', e, portalErrorStatus(e.code))
    throwContextError('PortalError', { code: 'upload_failed', message: 'Upload request failed' }, 422)
  }
  ```
- Fix: Re-throw non-portal errors instead of masking them. Untagged errors should propagate to `tracedHandler`'s catch-all.

### 6. [MAJOR] `dashboard.ts` uses `new Date()` directly for time range calculation
- File: `src/contexts/dashboard/server/dashboard.ts:17`
- Rule: Domain time must arrive as parameter or via injected Clock. Server functions should not compute business time ranges.
- Note: This is a borderline case — the server function is converting a preset to dates, which is view-logic, not business logic. Triage: **wontfix** — acceptable for a read-model context.

### 7. [MAJOR] `guest/server/public.ts` — rate limiting and IP hashing in server function
- File: `src/contexts/guest/server/public.ts:80-98,137-155`
- Rule: Server functions should be thin. Rate limiting, IP hashing, session extraction are business logic.
- Note: This is intentional — rate limiting needs request headers directly. Triage: **wontfix** — rate limiting at the edge is a standard pattern.

## Triage Summary

| # | Finding | Verdict |
|---|---------|---------|
| 1 | auth.functions.ts no tracedHandler | relevant — fix |
| 2 | auth.functions.ts no error handling | relevant — fix |
| 3 | dashboard.ts no error handling | relevant — fix |
| 4 | resolveLinkAndTrack no error handling | relevant — fix |
| 5 | portals upload error swallowing | relevant — fix |
| 6 | dashboard.ts new Date() | wontfix — view logic |
| 7 | guest rate limiting in server fn | wontfix — edge pattern |

## Per-Function 7-Step Checklist

### property/server/properties.ts
| Function | traced | auth | validate | perm | useCase | map | errors |
|----------|--------|------|----------|------|---------|-----|--------|
| createProperty | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| updateProperty | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| listProperties | ✅ | ✅ | ❌ no schema | ✅ (in UC) | ✅ | ✅ | ✅ |
| getProperty | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| deleteProperty | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |

### portal/server/portals.ts
| Function | traced | auth | validate | perm | useCase | map | errors |
|----------|--------|------|----------|------|---------|-----|--------|
| createPortal | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| updatePortal | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| listPortals | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| getPortal | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| deletePortal | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| requestUploadUrl | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ⚠️ swallows |
| finalizeUpload | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ⚠️ swallows |
| getPortalForQR | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |

### portal/server/portal-links.ts
| Function | traced | auth | validate | perm | useCase | map | errors |
|----------|--------|------|----------|------|---------|-----|--------|
| createLinkCategory | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| updateLinkCategory | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| deleteLinkCategory | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| reorderCategories | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| createLink | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| updateLink | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| deleteLink | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| reorderLinks | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| listPortalLinks | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |

### guest/server/public.ts
| Function | traced | auth | validate | perm | useCase | map | errors |
|----------|--------|------|----------|------|---------|-----|--------|
| getPublicPortal | ✅ | ❌ public | ✅ | N/A | ✅ | ✅ | ✅ |
| submitRatingFn | ✅ | ❌ public | ✅ | N/A | ✅ | ✅ | ✅ |
| submitFeedbackFn | ✅ | ❌ public | ✅ | N/A | ✅ | ✅ | ✅ |
| resolveLinkAndTrack | ✅ | ❌ public | ✅ | N/A | ✅ | ✅ | ❌ |

### team/server/teams.ts
| Function | traced | auth | validate | perm | useCase | map | errors |
|----------|--------|------|----------|------|---------|-----|--------|
| createTeam | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| updateTeam | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| listTeams | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| deleteTeam | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |

### staff/server/staff-assignments.ts
| Function | traced | auth | validate | perm | useCase | map | errors |
|----------|--------|------|----------|------|---------|-----|--------|
| createStaffAssignment | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| removeStaffAssignment | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| listStaffAssignments | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |

### integration/server/google-connections.ts
| Function | traced | auth | validate | perm | useCase | map | errors |
|----------|--------|------|----------|------|---------|-----|--------|
| getGoogleAuthUrl | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| connectGoogle | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| listGoogleConnections | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| disconnectGoogle | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| updateConnectionVisibility | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |

### integration/server/gbp-import.ts
| Function | traced | auth | validate | perm | useCase | map | errors |
|----------|--------|------|----------|------|---------|-----|--------|
| listGbpLocations | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| startPropertyImport | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| getImportStatus | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |

### integration/server/gbp-notifications.ts
Not a createServerFn — plain async function. N/A for 7-step checklist.
Correctly uses `trace()` for observability.

### review/server/reply.ts
| Function | traced | auth | validate | perm | useCase | map | errors |
|----------|--------|------|----------|------|---------|-----|--------|
| getReplyFn | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| draftReplyFn | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| submitReplyFn | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| approveReplyFn | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| rejectReplyFn | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| deleteReplyFn | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| retryPublishFn | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |

### inbox/server/inbox.ts
| Function | traced | auth | validate | perm | useCase | map | errors |
|----------|--------|------|----------|------|---------|-----|--------|
| getInboxItemsFn | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| updateInboxStatusFn | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| bulkUpdateInboxStatusFn | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| assignInboxItemFn | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| addInboxNoteFn | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| getUnreadCountFn | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| getInboxItemDetailFn | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| getInboxNotesFn | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |

### dashboard/server/dashboard.ts
| Function | traced | auth | validate | perm | useCase | map | errors |
|----------|--------|------|----------|------|---------|-----|--------|
| getDashboardDataFn | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ❌ |

### identity/server/auth-settings.ts
| Function | traced | auth | validate | perm | useCase | map | errors |
|----------|--------|------|----------|------|---------|-----|--------|
| changePasswordFn | ✅ | ❌ no resolveTenant | ✅ | N/A | ✅ (direct) | ✅ | ✅ |
| updateProfileFn | ✅ | ❌ no resolveTenant | ✅ | N/A | ✅ (direct) | ✅ | ✅ |
| updateUserImageFn | ✅ | ❌ no resolveTenant | ✅ | N/A | ✅ (direct) | ✅ | ✅ |
| createOrganizationFn | ✅ | ❌ no resolveTenant | ✅ | N/A | ✅ (direct) | ✅ | ✅ |

Note: auth-settings.ts functions are user-level (not tenant-scoped), so missing resolveTenantContext is correct.

### identity/server/organizations.ts
| Function | traced | auth | validate | perm | useCase | map | errors |
|----------|--------|------|----------|------|---------|-----|--------|
| getActiveOrganization | ✅ | ✅ | ❌ no schema | ✅ | ✅ | ✅ | ✅ |
| listMembers | ✅ | ✅ | ❌ no schema | ✅ | ✅ | ✅ | ✅ |
| inviteMember | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| acceptInvitation | ✅ | ✅ (requireAuth) | ✅ | ✅ | ✅ | ✅ | ✅ |
| cancelInvitation | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| resendInvitation | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| listInvitations | ✅ | ✅ | ❌ no schema | ✅ (in UC) | ✅ | ✅ | ✅ |
| updateMemberRole | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| removeMember | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| listUserInvitations | ✅ | ❌ no resolveTenant | ❌ no schema | ✅ | ✅ | ✅ | ✅ |
| setActiveOrganization | ✅ | ❌ no resolveTenant | ✅ | ✅ | ✅ | ✅ | ✅ |
| listUserOrganizations | ✅ | ❌ no resolveTenant | ❌ no schema | ✅ | ✅ | ✅ | ✅ |
| registerMember | ✅ | ❌ public | ✅ | N/A | ✅ | ✅ | ✅ |
| registerUserAndOrg | ✅ | ❌ public | ✅ | N/A | ✅ | ✅ | ✅ |
| signInUser | ✅ | ❌ public | ✅ | N/A | ✅ | ✅ | ✅ |
| updateOrganization | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| requestOrgLogoUpload | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| finalizeOrgLogoUpload | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| requestAvatarUpload | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |
| finalizeAvatarUpload | ✅ | ✅ | ✅ | ✅ (in UC) | ✅ | ✅ | ✅ |

### shared/auth/auth.functions.ts
| Function | traced | auth | validate | perm | useCase | map | errors |
|----------|--------|------|----------|------|---------|-----|--------|
| getSession | ❌ | ❌ | ❌ | N/A | ✅ | ✅ | ❌ |
| ensureActiveOrg | ❌ | ❌ | ❌ | N/A | ✅ | ✅ | ❌ |

## Summary

4 BLOCKER, 1 MAJOR relevant. 2 MAJOR wontfix.

Priority fix: `auth.functions.ts` — missing `tracedHandler` and error handling on both functions.
