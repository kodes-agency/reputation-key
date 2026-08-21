// Local-stack fault harness — evidence selection tests.
//
// Regression: the gbp fault probe's stdout carried a pino span-error record
// after its own verdict line, so the harness parsed the log record as the
// probe evidence. `observed` came out undefined, which passes `unavailable`
// (`observed !== 'success'`) and fails `failClosed`
// (`observed === 'failed-closed'`) — a real fail-closed was reported as a
// fail-closed violation, and the unavailability check became unfalsifiable.

import { describe, it, expect } from 'vitest'
import { selectProbeEvidence } from './probe-evidence'

const VERDICT =
  '{"dependency":"gbp","phase":"fault","observed":"failed-closed","error":"fetch failed"}'
// Verbatim from the beta-acceptance job that failed on main.
const SPAN_ERROR =
  '{"level":50,"time":1787316188342,"pid":325,"hostname":"aff8d24122db",' +
  '"span":"gbpApi.listAccounts","duration":42,"error":{"name":"TypeError"},' +
  '"msg":"Span gbpApi.listAccounts failed after 42ms"}'

describe('selectProbeEvidence', () => {
  it('returns the verdict when the logger flushes a span record after it', () => {
    expect(
      selectProbeEvidence(`${VERDICT}\n${SPAN_ERROR}\n`, 'gbp', 'fault'),
    ).toMatchObject({ dependency: 'gbp', phase: 'fault', observed: 'failed-closed' })
  })

  it('returns the verdict when the logger flushes before it', () => {
    expect(
      selectProbeEvidence(`${SPAN_ERROR}\n${VERDICT}\n`, 'gbp', 'fault'),
    ).toMatchObject({ observed: 'failed-closed' })
  })

  it('ignores non-JSON noise on the same stream', () => {
    const output = `Recreating perf-runner ...\n${VERDICT}\nnpm warn Unknown user config\n`
    expect(selectProbeEvidence(output, 'gbp', 'fault')).toMatchObject({
      observed: 'failed-closed',
    })
  })

  it('takes the last verdict when the probe ran more than once', () => {
    const stale = '{"dependency":"gbp","phase":"fault","observed":"success"}'
    expect(selectProbeEvidence(`${stale}\n${VERDICT}\n`, 'gbp', 'fault')).toMatchObject({
      observed: 'failed-closed',
    })
  })

  it('does not accept another dependency or phase as evidence', () => {
    expect(selectProbeEvidence(VERDICT, 'gbp', 'recovery')).toBeNull()
    expect(selectProbeEvidence(VERDICT, 'mail', 'fault')).toBeNull()
  })

  it('reports no evidence rather than passing a log record off as a verdict', () => {
    expect(selectProbeEvidence(SPAN_ERROR, 'gbp', 'fault')).toBeNull()
    expect(selectProbeEvidence('', 'gbp', 'fault')).toBeNull()
  })
})
