// BQC-3.8: never auto-publish an AI draft — the no-auto-publish invariant.
//
// A reply reaches Google ONLY through the publish-reply BullMQ job, and that
// job is enqueued ONLY by approveReply / retryPublish — both manager-gated
// (requireManager + D6-001 property access). Approval IS the human review: an
// aiGenerated reply is publishable only after a human passes it through
// pending_approval → approved. The domain half of the proof lives in
// src/contexts/review/domain/rules.test.ts (transitionReply — the single
// authority for every reply write — refuses draft → approved for ANY reply,
// aiGenerated included, so no code path can skip the human review).
//
// This test pins the static half:
//   (a) addPublishJob call sites exist ONLY in reply-operations.ts
//       (approveReply/retryPublish) — no sync, import, mirror, cron, or
//       event-handler path may enqueue a publish;
//   (b) every enqueue site requires a human AuthContext (requireManager in
//       the same function, before the enqueue);
//   (c) the publish job's own mark-ops use a NO-OP queue, so a mark can
//       never re-enqueue a publish (no self-publish loop).

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

const OPS_FILE = 'src/contexts/review/application/use-cases/reply-operations.ts'
const JOB_FILE = 'src/contexts/review/infrastructure/jobs/publish-reply.job.ts'

const CALL_RE = /\.addPublishJob\s*\(/

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

  it('(a) addPublishJob is called ONLY from reply-operations.ts', () => {
    expect(callSiteFiles).toEqual([OPS_FILE])
    // Exactly the two human-gated enqueue sites: approveReply + retryPublish.
    expect(read(OPS_FILE).match(new RegExp(CALL_RE.source, 'g'))).toHaveLength(2)
  })

  it('(b) every publish enqueue site requires a human AuthContext first', () => {
    const ops = read(OPS_FILE)
    for (const fn of ['approveReply', 'retryPublish']) {
      const body = functionBlock(ops, fn)
      expect(body, `${fn} must call requireManager(ctx)`).toContain('requireManager(ctx)')
      expect(CALL_RE.test(body), `${fn} must contain the publish enqueue`).toBe(true)
      expect(
        body.indexOf('requireManager(ctx)'),
        `${fn}: requireManager must precede the enqueue`,
      ).toBeLessThan(body.search(CALL_RE))
    }
  })

  it('(c) the publish job marks through a no-op queue — never re-enqueues itself', () => {
    const job = read(JOB_FILE)
    expect(job).toContain('addPublishJob: async () => {}')
    expect(CALL_RE.test(job)).toBe(false)
  })
})
