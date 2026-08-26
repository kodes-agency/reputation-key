// BQC-3.8: never auto-publish an AI draft — the no-auto-publish invariant.
//
// A reply reaches Google ONLY through the publish-reply BullMQ job. A manager-
// gated approve/retry/edit command both records a durable publication request
// and attempts low-latency queue admission; the worker recovery consumer may
// only redeliver that exact committed request/cycle. Approval IS the human
// review: an aiGenerated reply is publishable only after a human passes it
// through pending_approval → approved. The domain half of the proof lives in
// src/contexts/review/domain/rules.test.ts (transitionReply — the single
// authority for every reply write — refuses draft → approved for ANY reply,
// aiGenerated included, so no code path can skip the human review).
//
// This test pins the static half:
//   (a) addPublishJob call sites exist ONLY in reply-operations.ts and the
//       publication-request recovery consumer;
//   (b) each command-side request and enqueue follows its human manager gate;
//   (c) recovery validates the registered identifier-only request, then
//       reloads and fences the exact approved publication cycle;
//   (d) the publish job has no queue dependency, so it cannot enqueue itself.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

const OPS_FILE = 'src/contexts/review/application/use-cases/reply-operations.ts'
const RECOVERY_FILE = 'src/contexts/review/infrastructure/outbox-consumers.ts'
const JOB_FILE = 'src/contexts/review/infrastructure/jobs/publish-reply.job.ts'

const CALL_RE = /\.addPublishJob\s*\(/
const REQUEST_RE = /\breviewReplyPublicationRequested\s*\(/

function walkTsFiles(dir: string): string[] {
  const out: string[] = []
  if (!existsSync(dir)) return out
  const walk = (d: string) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (
        ent.name.endsWith('.ts') &&
        !ent.name.endsWith('.test.ts') &&
        !ent.name.endsWith('.d.ts')
      ) {
        out.push(relative(ROOT, p))
      }
    }
  }
  walk(dir)
  return out
}

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8')

/** Extract one `export const name = ...` block (up to the next export const). */
function functionBlock(source: string, name: string): string {
  const start = source.indexOf(`export const ${name}`)
  expect(start, `export const ${name} not found`).toBeGreaterThanOrEqual(0)
  const end = source.indexOf('export const ', start + 1)
  return source.slice(start, end === -1 ? undefined : end)
}

describe('BQC-3.8: no-auto-publish invariant', () => {
  const callSiteFiles = walkTsFiles(SRC).filter((f) => CALL_RE.test(read(f)))
  const requestProducerFiles = walkTsFiles(SRC).filter((f) => REQUEST_RE.test(read(f)))

  it('(a) addPublishJob is called only by manager commands or durable intent recovery', () => {
    expect([...callSiteFiles].sort()).toEqual([OPS_FILE, RECOVERY_FILE].sort())
    // Exactly the three human-gated enqueue sites: approveReply + retryPublish
    // + editPublishedReply, plus one recovery delivery of the committed intent.
    expect(read(OPS_FILE).match(new RegExp(CALL_RE.source, 'g'))).toHaveLength(3)
    expect(read(RECOVERY_FILE).match(new RegExp(CALL_RE.source, 'g'))).toHaveLength(1)
    expect(requestProducerFiles).toEqual([OPS_FILE])
    expect(read(OPS_FILE).match(new RegExp(REQUEST_RE.source, 'g'))).toHaveLength(3)
  })

  it('(b) every command-side publication request requires a human AuthContext first', () => {
    const ops = read(OPS_FILE)
    // BQC-5.9 E5: the manager gate is single-sourced in requireAccessibleReply
    // (requireManager is its first statement, before any row load); the
    // approve/retry sites call it, editPublishedReply keeps its explicit
    // requireManager before the published-status check.
    const helperStart = ops.indexOf('async function requireAccessibleReply')
    expect(helperStart, 'requireAccessibleReply helper not found').toBeGreaterThanOrEqual(
      0,
    )
    const helperBody = ops.slice(helperStart, ops.indexOf('export type DraftReply'))
    expect(helperBody).toContain('requireManager(ctx)')
    expect(helperBody.indexOf('requireManager(ctx)')).toBeLessThan(
      helperBody.indexOf('findInternalByReviewId'),
    )
    for (const fn of ['approveReply', 'retryPublish', 'editPublishedReply']) {
      const body = functionBlock(ops, fn)
      const gate =
        fn === 'editPublishedReply' ? 'requireManager(ctx)' : 'requireAccessibleReply('
      expect(body, `${fn} must call ${gate}`).toContain(gate)
      expect(body, `${fn} must durably authorize the publication cycle`).toContain(
        'reviewReplyPublicationRequested(',
      )
      expect(CALL_RE.test(body), `${fn} must contain the publish enqueue`).toBe(true)
      expect(
        body.indexOf(gate),
        `${fn}: the manager gate must precede the enqueue`,
      ).toBeLessThan(body.search(CALL_RE))
      expect(
        body.indexOf('reviewReplyPublicationRequested('),
        `${fn}: durable authorization must precede direct queue admission`,
      ).toBeLessThan(body.search(CALL_RE))
    }
  })

  it('(c) recovery admits only an exact current manager-authorized cycle', () => {
    const recovery = read(RECOVERY_FILE)
    const enqueue = recovery.search(CALL_RE)
    expect(recovery).toContain(
      "const EVENT_TYPE = 'review.reply.publication_requested' as const",
    )
    expect(recovery).toContain('validateEventPayload(EVENT_TYPE')
    expect(recovery).toContain('current.publicationCycle !== payload.publicationCycle')
    expect(recovery).toContain("current.status !== 'approved'")
    expect(recovery).toContain("current.publicationState !== 'authorized'")
    expect(recovery).toContain("current.publicationState !== 'sending'")
    expect(enqueue).toBeGreaterThan(recovery.indexOf('validateEventPayload(EVENT_TYPE'))
    expect(enqueue).toBeGreaterThan(
      recovery.indexOf('current.publicationCycle !== payload.publicationCycle'),
    )
  })

  it('(d) the publish job has no queue dependency and never re-enqueues itself', () => {
    const job = read(JOB_FILE)
    expect(job).not.toContain('ReplyQueuePort')
    expect(CALL_RE.test(job)).toBe(false)
  })
})
