# GOV-01 local implementation evidence — 2026-08-28

This record closes the repository-owned implementation axis for GOV-01. It
does not replace the immutable-candidate CI run, current vulnerability feeds,
runtime image execution, or Railway deployment evidence.

## Repository authority

`security/technology-stack.json` is the checked source of truth for the exact
Node/pnpm versions, 41 core package/CLI authorities, 11 third-party GitHub
Actions, 10 governed runtime/CI images, Redis/BullMQ/PostgreSQL/pino contracts,
review dates, owners, and the one time-bounded exception. Executable checks
compare it with package manifests, the lockfile, workflows, Dockerfiles,
runtime probes, and approved command surfaces. Negative fixtures prove the
checks reject ranged dependencies, mutable CLIs/actions/images, schema push,
missing queue error handling, and statement-level PostgreSQL retry.

Feature-owner migrations now provide the repository-wide TanStack Query/Form,
current validator, React, Better Auth, Zod v4, queue, and application-error
controls. Narrow accepted maintainability exceptions remain explicit in the
GOV-02 register; they are not silently described as conformance.

## Verification run

On 2026-08-28:

- technology-stack authority passed: Node 22.23.2, 41 packages, 11 Actions,
  10 images, one owned exception;
- container policy passed for all 10 Dockerfiles;
- all 76 workflow Action/image references were immutable;
- the Zod v4 source gate passed;
- 11 focused unit files / 64 tests passed for negative authority fixtures,
  built-ESM pino, Better Auth field controls, PostgreSQL acquisition-only
  retry, Redis topology/runtime, BullMQ scheduling/worker behavior, and
  process wiring.

## External gates deliberately still open

Final repository verification remains tied to the immutable release candidate.
It must include a frozen install, every runtime image build/smoke/SBOM/scan,
hosted CI, current dependency/vulnerability databases, and deployed Railway
runtime checks. Local source validation cannot manufacture those artifacts.
