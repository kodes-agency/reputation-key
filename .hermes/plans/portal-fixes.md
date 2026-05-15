# Portal Issues — Fix Plan

## From audit (12 issues)

### P0 — High

| #   | Issue                                    | File              | Fix                                                         |
| --- | ---------------------------------------- | ----------------- | ----------------------------------------------------------- |
| 1   | No invalidation after deletePortal       | portals/index.tsx | Add `invalidateRoutes` or `router.invalidate()`             |
| 2   | Loader strips domain types with .map()   | $portalId.tsx     | Pass categories/links through directly                      |
| 3   | useServerFn mixed with useMutationAction | $portalId.tsx     | Keep useServerFn for uploads (correct pattern), add comment |

### P1 — Medium

| #   | Issue                                   | File                       | Fix                                                    |
| --- | --------------------------------------- | -------------------------- | ------------------------------------------------------ |
| 4   | Component imports 8 server fns directly | use-link-tree-mutations.ts | Already documented exception — acceptable              |
| 5   | Double toasts (mutation + catch)        | use-link-tree-state.ts     | Remove toast.error() calls from catch blocks           |
| 6   | Duplicate type defs across 4 files      | multiple                   | Extract to shared link-tree types file                 |
| 7   | Branded ID casting in mappers           | portal.mapper.ts           | Leave as-is (known escape hatch), add unbrand() helper |

### P2 — Low

| #   | Issue                                        | File                             | Fix                            |
| --- | -------------------------------------------- | -------------------------------- | ------------------------------ |
| 8   | Loader swallows errors                       | portals/index.tsx                | Let errors propagate           |
| 9   | O(n) property slug lookup                    | $portalId.tsx, portals/index.tsx | Extract helper or use Map      |
| 10  | useEffect runs every render for preview sync | create-portal-form.tsx           | Use form.useStore or Subscribe |
| 11  | `as unknown` casts for error props           | link-tree.tsx                    | Fix the type narrowing         |
| 12  | No permission check on listPortals           | list-portals.ts                  | Flag — may be intentional      |

## Execution Order

1. Shared types extraction (#6)
2. Portal list fixes (#1, #8)
3. Portal detail route fixes (#2, #3, #9)
4. Link tree fixes (#5, #11)
5. Form fix (#10)
6. Verify tsc --noEmit
7. Review loop
