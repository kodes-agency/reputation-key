// What the documents say about alerts, held to the registry.
//
// The alert guide listed `routing.region-attempts`, the runbooks sent the
// operator to it, and no such alert was ever defined: an operator waiting for
// it waits for nothing.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ALERT_DEFINITIONS } from './alert-definitions'

const ALERT_GUIDE = readFileSync('docs/operations/alerts-and-security-posture.md', 'utf8')
const RUNBOOKS = readFileSync('docs/operations/runbooks.md', 'utf8')

/** A dotted name in code quotes, as the documents write an alert. */
const ALERT_NAME = /`([a-z][a-z-]*(?:\.[a-z][a-z-]*)+)`/g

type DocumentedAlert = Readonly<{ name: string; severity: string; runbook: string }>

/** Rows of the guide's alert tables: `name`, severity, …, runbook section. */
function documentedAlerts(tableHeader: RegExp): readonly DocumentedAlert[] {
  const start = ALERT_GUIDE.search(tableHeader)
  const table = ALERT_GUIDE.slice(start).split(/\n\s*\n/)[0] ?? ''
  return [...table.matchAll(/^\| `([^`]+)`\s*\| (P\d)\s*\|.*\| (§\d+)\s*\|$/gm)].map(
    (row) => ({
      name: row[1] ?? '',
      severity: row[2] ?? '',
      runbook: `runbooks.md ${row[3]}`,
    }),
  )
}

const registered = (implemented: boolean): readonly DocumentedAlert[] =>
  ALERT_DEFINITIONS.filter((definition) => definition.implemented === implemented).map(
    ({ name, severity, runbook }) => ({ name, severity, runbook }),
  )

const byName = (alerts: readonly DocumentedAlert[]): readonly DocumentedAlert[] =>
  [...alerts].sort((left, right) => left.name.localeCompare(right.name))

describe('the alert guide', () => {
  it('lists exactly the alerts the health check evaluates, with their severity and runbook', () => {
    expect(byName(documentedAlerts(/^\| Alert +\| Sev \| Threshold/m))).toEqual(
      byName(registered(true)),
    )
  })

  it('lists exactly the alerts that are registered and not implemented', () => {
    expect(byName(documentedAlerts(/^\| Alert +\| Sev \| Signal source/m))).toEqual(
      byName(registered(false)),
    )
  })
})

describe('the runbooks', () => {
  // An alert is cited as `name` (P1) or as "the `name` alert".
  it('cite no alert the registry does not define', () => {
    const defined = new Set(ALERT_DEFINITIONS.map(({ name }) => name))
    const cited = [
      ...RUNBOOKS.matchAll(new RegExp(`${ALERT_NAME.source}(?= alert| \\(P[0-3])`, 'g')),
    ].map((match) => match[1] ?? '')

    expect(cited.length).toBeGreaterThan(0)
    expect(cited.filter((name) => !defined.has(name))).toEqual([])
  })
})
