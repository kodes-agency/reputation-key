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

## Labels outside the triage vocabulary

These exist on the repo but are **not** triage states. Don't treat them as part
of the state machine, and don't move an issue between them during `/triage`:

- `wayfinder:map`, `wayfinder:research`, `wayfinder:prototype`,
  `wayfinder:grilling`, `wayfinder:task` — owned by `/wayfinder`; see the
  "Wayfinding operations" section of [issue-tracker.md](./issue-tracker.md).
- `beta-acceptance` — a PR label that runs the hermetic beta-acceptance gate.
- GitHub's stock set (`bug`, `enhancement`, `documentation`, `question`,
  `duplicate`, `invalid`, `good first issue`, `help wanted`) — descriptive
  only.

Edit the right-hand column above if the vocabulary ever changes.
