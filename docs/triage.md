# Triage and the work queue

Issues and PRDs live as GitHub issues on `kodes-agency/reputation-key`.
Use the `gh` CLI from a checkout. Pull requests represent implementation work;
they are not incoming requests and are excluded from triage. Sentry is the
source for errors that need code work. Beta feedback keeps its existing intake,
triage and issue bridge; public issues carry controlled vocabulary and monitoring
links, never reporter text or pseudonyms.

## Classify an issue

Every issue has exactly one triage label and one type label. Add a source label
when it came from Sentry or beta feedback.

| Triage label      | Meaning                                                      |
| ----------------- | ------------------------------------------------------------ |
| `needs-triage`    | A maintainer must evaluate it.                               |
| `needs-info`      | The reporter must supply missing information.                |
| `ready-for-agent` | It has a complete brief and can be implemented autonomously. |
| `ready-for-human` | It requires human implementation.                            |
| `wontfix`         | It will not be actioned.                                     |

Types are `type:bug`, `type:feature`, `type:improvement` and `type:chore`.
Sources are `source:sentry` and `source:beta-feedback`. The board's Horizon and
Priority fields describe timing and importance. Labels determine the triage
board column; do not move the card by hand.

## Prepare and implement

Read the issue, its comments, the relevant area map and accepted ADRs. Establish
the current behaviour and write acceptance examples. A ready brief names the
problem, intended outcome, preserved behaviour, verification and dependencies.
Keep reachable features unless an explicit product decision authorizes a change.

Use native sub-issues and blocking dependencies to divide larger work. Keep one
concern per change. Report results and unresolved dependencies on the issue;
close it only when the promised outcome and applicable checks are complete.

```bash
gh issue view <number> --comments
gh issue list --state open --label needs-triage
gh issue edit <number> --add-label ready-for-agent --remove-label needs-triage
```

The [tracker reference](agents/issue-tracker.md) has issue creation, dependency,
board and Sentry procedures. The [label reference](agents/triage-labels.md)
describes the existing label integration; changing a bridge label requires
changing its caller in the same change.
