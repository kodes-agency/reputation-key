# Archive

Historical documents. **Nothing here describes current behaviour** — do not
follow a procedure, plan, or status table from this directory, and do not treat
its statements as requirements.

Kept for provenance only:

| Path                                                                  | What it was                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `plans/`, `plan/`                                                     | superseded implementation plans                                          |
| `review-run/`, `audit/`, `audits/`                                    | one-off review and audit runs                                            |
| `product-readiness-program-2026-07/beta-quality-remediation-2026-07/` | the closed BQC/BQR remediation programme, including its STATUS manifests |

`pnpm bqc:run-baseline` still writes its evidence under the archived
`beta-quality-remediation-2026-07/completion-program-2026-07/` directory, which
is why that tree is archived rather than deleted.

Current documentation lives in `docs/adr/`, `docs/operations/`,
`docs/standards.md`, and the per-context `src/contexts/*/CONTEXT.md` files.
