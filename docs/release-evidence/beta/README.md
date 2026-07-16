# Beta release evidence packs

Each candidate build that claims BQR completion creates a directory:

```text
docs/release-evidence/beta/<release-id>/
  manifest.md
  quality-gates.md
  migration-and-schema.md
  event-and-job-reliability.md
  security-and-privacy.md
  accessibility-and-performance.md
  scale-and-recovery.md
  pilot-observations.md
  exceptions.md
  approval.md
```

See BQR master plan §7.3. Scaffold templates live in `_template/`.

Until a release candidate is cut, keep filling `_template/` and link PRE17C / BQR phase evidence there.
