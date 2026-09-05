# Reputation Key — agent guide

## Agent skills

### Issue tracker

Issues, PRDs and wayfinder maps live as GitHub issues on
`kodes-agency/reputation-key`, driven through the `gh` CLI; pull requests are
**not** a request surface, so `/triage` ignores them. Wayfinder maps use native
GitHub sub-issues and issue dependencies. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles map one-to-one to labels that already exist on
the repo: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`,
`wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Root-indexed multi-context: root `CONTEXT.md` is the map — read it first, then
follow its Layer guides and Bounded contexts tables to the relevant nested
`CONTEXT.md`. ADRs are system-wide in `docs/adr/`, navigated via its `README.md`.
See `docs/agents/domain.md`.
