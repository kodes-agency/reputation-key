# BQR-5 — Blocking Experience Verification (E2E, Storybook, A11y)

**Status:** In progress — slice 5.2  
**Depends on:** BQR-3 (user paths), BQR-4 (auth gates on those paths)  
**Unblocks:** BQR-6 evidence pack, BQR-7 pilot readiness  
**Estimate:** 8–13 engineering days

## Outcome

Critical authenticated user flows have **blocking** Playwright coverage. Storybook component tests (including a11y) remain a hard CI gate. Soft-gated jobs that supply required beta evidence are eliminated or promoted to hard fail with green suites.

Master plan §8: no required evidence job may use `continue-on-error` without an approved, expiring exception.

## PR slices (planned)

| Slice       | Outcome                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------- |
| **BQR-5.1** | Critical Playwright hard-gated; seed property; residual full suite soft — **done (#202)**   |
| **BQR-5.2** | Expand critical (inbox + members + property people/reviews); rewrite residual to product UI |
| **BQR-5.3** | Storybook-test remains hard; document/fix storybook **build** soft-gate or remove exception |
| **BQR-5.4** | A11y regressions covered via Storybook a11y addon on critical components                    |

### BQR-5.2 residual exceptions (expiring)

| Spec / path                          | Reason                                                           | Next step                                    |
| ------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------- |
| `guest-portal.spec.ts`               | No seeded public portal fixture                                  | Seed portal in BQR-6/7 fixtures              |
| Full UI `registerAccount` (residual) | Mutation path flaky under CI; critical covers capability surface | Diagnose ensureActiveOrg/mutation; keep soft |
| Password reset / invite email        | CI uses placeholder RESEND_API_KEY                               | Accept shell + response; real mail in pilot  |

## Exit criteria

| Criterion                                                 | Target    |
| --------------------------------------------------------- | --------- |
| Critical path Playwright specs green on main CI           | Hard fail |
| storybook-test job hard fail                              | Already   |
| storybook build either hard-green or documented exception | Explicit  |
| No silent soft-fail on required evidence without ticket   | Yes       |

## Notes

- BQR-2.5 CI fix (#198) added seed user + Redis and soft-gated e2e residual UI drift.
- BQR-5 owns turning residual soft gates into hard green or approved exceptions.
