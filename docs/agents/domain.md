# Domain Docs

How the engineering skills should consume this repo's domain documentation when
exploring the codebase.

**Layout: root-indexed multi-context.** There is no `CONTEXT-MAP.md` here —
the root `CONTEXT.md` _is_ the map. Its "Layer guides" and "Bounded contexts"
tables point at the per-area `CONTEXT.md` files. Treat root `CONTEXT.md`
exactly as the skills treat `CONTEXT-MAP.md` elsewhere: read it first, then
follow it to the areas you actually need.

## Before exploring, read these

1. **`CONTEXT.md`** at the repo root — architecture, the Layer guides table,
   the bounded-context list, and the Glossary.
2. **The nested `CONTEXT.md`** for the area you're working in, reached from the
   root file's tables. Read every one relevant to the topic, not just the
   nearest:

   | Working in                                        | Read this                   |
   | ------------------------------------------------- | --------------------------- |
   | Components, forms, hooks                          | `src/components/CONTEXT.md` |
   | Domain, use cases, repos, server functions        | `src/contexts/CONTEXT.md`   |
   | Shared infrastructure, auth, cache, observability | `src/shared/CONTEXT.md`     |
   | Routes, loaders, mutations, auth guards           | `src/routes/CONTEXT.md`     |

   Each bounded context under `src/contexts/<ctx>/` has its own `CONTEXT.md`
   as well. Root `CONTEXT.md` is authoritative for which contexts exist and
   which are quarantined — don't infer that from the presence of a directory.

3. **`docs/adr/`** — start at [`docs/adr/README.md`](../adr/README.md), which
   is the navigation authority and records each ADR's _current disposition_.
   A file remaining in the directory does not make its clauses current, and
   superseded ADRs are retained rather than deleted. Read the ADRs that touch
   your area, and honour the precedence order stated in that README: external
   obligations, the approved product contract, accepted superseding ADRs,
   active standards, executable enforcement, then legacy implementation notes.

   ADRs are **system-wide only** — all of them live in `docs/adr/`. There are
   no context-scoped `src/<context>/docs/adr/` directories; don't go looking.

If any of these files don't exist, **proceed silently**. Don't flag their
absence; don't suggest creating them upfront. The `/domain-modeling` skill
(reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates
them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── CONTEXT.md                         ← the map: architecture, layer guides, glossary
├── docs/adr/                          ← system-wide decisions
│   ├── README.md                      ← navigation authority + dispositions
│   ├── 0001-dynamic-access-control.md
│   └── …additional numbered decision records
└── src/
    ├── components/CONTEXT.md
    ├── routes/CONTEXT.md
    ├── shared/CONTEXT.md
    └── contexts/
        ├── CONTEXT.md                 ← index for the bounded contexts
        ├── identity/CONTEXT.md
        ├── property/CONTEXT.md
        └── …one per bounded context
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor
proposal, a hypothesis, a test name), use the term as defined in the Glossary
section of root `CONTEXT.md`. Don't drift to synonyms the glossary explicitly
avoids.

If the concept you need isn't in the glossary yet, that's a signal — either
you're inventing language the project doesn't use (reconsider) or there's a
real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than
silently overriding:

> _Contradicts ADR-0007 — but worth reopening because…_

Check `docs/adr/README.md` first: the ADR you think you're contradicting may
already be marked historical or superseded, in which case say which ADR
currently governs instead.
