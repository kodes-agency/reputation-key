# Archive

Historical documents. **Nothing here describes current behaviour** — do not
follow a procedure, plan, or status table from this directory, and do not treat
its statements as requirements.

Kept for provenance only:

- [`LEAN_TRANSFORMATION_PLAN.md`](LEAN_TRANSFORMATION_PLAN.md) — the roadmap and
  execution specs of the September 2026 lean programme, finished and deployed
  2026-09-08. Moved here from the repository root.
- [`2026-09-lean/product-readiness-program-2026-07/ai-governance/`](2026-09-lean/product-readiness-program-2026-07/ai-governance/README.md)
  — the AI and Google Source Governance package. The manifest
  `src/contexts/ai/domain/catalogues/ai-private-beta-policy-v1.manifest.json`
  pins two of its files, `ai-private-beta-policy-v1.md` and
  `ai-private-beta-policy-evidence-index.json`, by path and sha256: do not move,
  rename, reflow or edit them.

Everything else that was archived here (superseded plans, one-off review and
audit runs, the closed BQC/BQR remediation programme, and the rest of
`2026-09-lean/`) was removed from the tree on 2026-10-27. It is all in git
history at `944895e91`: `git ls-tree -r --name-only 944895e91 -- docs/archive`
lists it and `git show 944895e91:<path>` prints one file.

Some links inside the `ai-governance/` files no longer resolve. They point at
siblings that were removed (`../ai-governance-primary-sources-2026-07-14.md`) or
at files that moved before the archive (`../../adr/0031-…`, now
`docs/adr/0031-google-source-content-and-ai-processing-boundary.md`;
`../google-business-profile-ai-policy-response-2026-07-14.md`, now
`docs/external/google/google-business-profile-ai-policy-response-2026-07-14.md`).
Two of the files are hash-pinned and the package is kept as one unit, so the
links stay as they are.

Current documentation lives in `docs/adr/`, `docs/operations/`,
`docs/standards.md`, and the per-context `src/contexts/*/CONTEXT.md` files.
