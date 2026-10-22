# Issue tracker: GitHub

Issues, PRDs and wayfinder maps for this repo live as GitHub issues on
`kodes-agency/reputation-key`. Use the `gh` CLI for all operations; it infers
the repo from `git remote -v` when run inside a clone or worktree.

There is no `.scratch/` convention here. If you find yourself about to create
one, you are on the wrong tracker.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`, with `--label` / `--state` filters as needed.
- **Comment**: `gh issue comment <number> --body "..."`
- **Labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

## Pull requests as a triage surface

**PRs as a request surface: no.** This repo is developed by a single owner;
there are no external contributors, so a PR is a unit of work in progress, not
an incoming request. `/triage` should ignore pull requests entirely.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue; its tickets are **native
GitHub sub-issues** of it. Both sub-issues and issue dependencies are enabled
on this repo — verified against the API — so neither body-convention fallback
is needed. Use the native relationships: they render the frontier in GitHub's
own UI, which is the point of keeping the map there rather than in a file.

- **Map**: `gh issue create --label wayfinder:map`. Body holds Destination / Notes / Decisions-so-far / Not-yet-specified / Out-of-scope.
- **Child ticket**: `gh issue create --label wayfinder:<type>`, then attach it:

  ```bash
  gh api --method POST repos/kodes-agency/reputation-key/issues/<map>/sub_issues \
    -F sub_issue_id=<child-database-id>
  ```

  `<child-database-id>` is the numeric `.id`, **not** the `#number` and not the
  `node_id`: `gh api repos/kodes-agency/reputation-key/issues/<n> --jq .id`.
  Types are `wayfinder:research` / `prototype` / `grilling` / `task`.

- **Blocking**: native issue dependencies.

  ```bash
  gh api --method POST repos/kodes-agency/reputation-key/issues/<child>/dependencies/blocked_by \
    -F issue_id=<blocker-database-id>
  ```

  `issue_dependencies_summary.blocked_by` counts **open** blockers only, so it
  is the live gate — a ticket is unblocked when that reaches 0.

- **Frontier query**: the map's open sub-issues with `blocked_by == 0` and no assignee, first in map order.

  ```bash
  gh api repos/kodes-agency/reputation-key/issues/<map>/sub_issues \
    --jq '.[] | select(.state=="open") | select(.issue_dependencies_summary.blocked_by==0) | select(.assignee==null) | "#\(.number) \(.title)"'
  ```

- **Claim**: `gh issue edit <n> --add-assignee kodes-agency` — the session's first write, before any work. `@me` resolves to the same account.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a one-line context pointer (gist + link) to the map's Decisions-so-far.

## Label vocabulary

Triage roles map to the repo's existing labels one-to-one: `needs-triage`,
`needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. Wayfinder adds
`wayfinder:map`, `wayfinder:research`, `wayfinder:prototype`,
`wayfinder:grilling`, `wayfinder:task`.

## Triage board

Open issues also show as cards on a board: GitHub Project #1 of the
`kodes-agency` user, "Reputation Key"
(<https://github.com/users/kodes-agency/projects/1>, private, linked to this
repo). Its columns are the five triage labels, held as the options of the
project's built-in **Status** field, because a board column must be a
single-select field. Issues with no triage label sit in **No Status**.

**Labels are the source of truth; never set a card's column by hand.** The
`Triage board` workflow (`.github/workflows/triage-board.yml`, running
`scripts/ci/sync-triage-board.ts`) adds every new or reopened issue and moves
its card whenever a triage label is added or removed. An issue with two triage
labels goes to the one furthest along (`wontfix`, `ready-for-human`,
`ready-for-agent`, `needs-info`, `needs-triage`) and the run warns about the
other. Closed issues drop off the board's view.

The workflow needs the `TRIAGE_BOARD_TOKEN` repository secret: a classic
personal access token with only the `project` scope, since the workflow's own
token cannot write a user's project. When the token expires every run fails
with a message naming the secret. Renaming a triage label means renaming the
matching Status option too, or the run fails before it changes anything.

The project's built-in "Auto-add sub-issues to project" automation is on, so
it also pulls in the sub-issues of an issue added to the board.
