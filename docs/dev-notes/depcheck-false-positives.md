# Depcheck False Positives

These dependencies appear as "unused" in `npx depcheck` but are consumed by
config files, build tools, or platform-native binaries (not by source imports).

| Dependency | Reason |
|-----------|--------|
| `tailwindcss` | Consumed via PostCSS config (`postcss.config.mjs`). No source import needed. |
| `@rolldown/binding-*` | Platform-native binary required by Vite/Rolldown build. Depcheck cannot detect. |

Last updated: 2026-05-30
