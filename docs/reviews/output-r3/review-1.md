# Review 1 — Architecture & Layering

**Branch:** feat/phase-15c-goal-ui
**Date:** 2026-05-23

## Findings

### [MAJOR] Infrastructure imports from server layer

File: `src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts:18`
Quote:

```
import { getRequest } from '@tanstack/react-start/server'
```

Rule: Infrastructure layer must never import from server/framework packages. CONTEXT.md dependency rules: `infrastructure/` may import from `application/`, `domain/`, `shared/`, external libs — never from `server/`.
Fix: Move the `getRequest()` usage out of the infrastructure adapter. Pass the request/context as a parameter through a port interface.

### [NIT] Goal context has `ui/` layer outside the standard four-layer structure

File: `src/contexts/goal/ui/helpers.ts`
The `ui/` folder is not part of the standard four-layer architecture (domain/application/infrastructure/server). While `helpers.ts` only imports a DTO type from `goal/application/dto/goal.dto`, this layer should be documented or moved to `src/components/`.

### Checks passed (no issues)

- **Domain → upper layers:** No domain file imports from application, infrastructure, server, or routes ✅
- **Application → infrastructure/server:** No application file imports from infrastructure or server ✅
- **Infrastructure → server:** Only the one finding above ✅
- **Server → infrastructure:** No server file imports from infrastructure ✅
- **Cross-context internal imports:** No file imports from another context's domain, application/use-cases, or infrastructure layers. All cross-context access goes through `application/public-api.ts` ✅
- **Routes direct DB queries:** No `src/routes/` file directly queries a database table ✅

## Counts

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| MAJOR    | 1     |
| MINOR    | 0     |
| NIT      | 1     |

**Most important thing to fix first:** Move `getRequest()` out of `auth-identity.adapter.ts` — infrastructure must not depend on the server framework.
