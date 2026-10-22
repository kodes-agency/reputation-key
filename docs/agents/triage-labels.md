# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those
roles to the actual label strings used in this repo's issue tracker
(GitHub — see [issue-tracker.md](./issue-tracker.md)).

All five roles map one-to-one: the labels already exist on
`kodes-agency/reputation-key` under their canonical names, so there is nothing
to translate and no duplicate to avoid creating.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the
corresponding label string from this table.

Apply with `gh issue edit <number> --add-label "..."` / `--remove-label "..."`.

The triage board follows these labels by itself; see "Triage board" in
[issue-tracker.md](./issue-tracker.md). Change the label, not the card.

Edit the right-hand column above if the vocabulary ever changes.

## Type labels

Every issue also carries exactly one type, saying what it is. Types are not
triage states: setting one never moves a card.

| Label              | Use for                                                        |
| ------------------ | -------------------------------------------------------------- |
| `type:bug`         | Something is broken: it does not do what it is meant to        |
| `type:feature`     | Something new, including suggestions and "maybe one day" ideas |
| `type:improvement` | Making something that exists better: UX, wording, speed        |
| `type:chore`       | Tech debt, refactors, CI, dependencies, docs                   |

## Source labels

Optional; add one when the issue came from outside the codebase, so each
stream can be filtered and followed up.

| Label                  | Use for                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| `source:sentry`        | An error in Sentry that needs code work (see "Sentry" in issue-tracker) |
| `source:beta-feedback` | A beta report; `pnpm ops feedback-issue` adds it                        |

Planning (when something happens and how much it matters) lives in the board's
Horizon and Priority fields, not in labels; see "Roadmap fields" in
[issue-tracker.md](./issue-tracker.md).

`pnpm ops feedback-issue` requests `type:bug` or `type:feature` plus
`source:beta-feedback` and `needs-triage` by name, and `gh issue create` fails on
a label the repository does not have. Renaming any of those labels means
changing `src/contexts/identity/application/beta-feedback-issue.ts` in the same
change.
