#!/usr/bin/env node
// BQC-7.7 — pinned-actions gate (supply-chain integrity for CI itself).
//
// Parses every .github/workflows/*.yml line-wise (the workflows are stable in
// shape; no YAML dependency) and enforces:
//
//   uses: <ref>     every action reference must be pinned to a full 40-char
//                   lowercase hex commit SHA AND carry a trailing `# v…`
//                   version comment for human review, e.g.
//                     - uses: actions/checkout@9c091bb… # v7.0.0
//                   Local references (./…) are exempt (same-repo code).
//                   docker:// references must be digest-pinned
//                   (docker://image@sha256:<64 lowercase hex>).
//   image: <ref>    service/job container images must be digest-pinned
//                   (name:tag@sha256:<64 lowercase hex>) — a trailing comment
//                   with the tag is conventional but not required.
//
// Together with `pnpm install --frozen-lockfile` everywhere (the lockfile
// integrity gate) this closes the "pin your inputs" supply-chain control —
// see docs/operations/security-ci-policy.md.
// There is no continue-on-error anywhere: a red gate blocks the PR.

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WORKFLOWS_DIR = join(ROOT, '.github', 'workflows')

const SHA_RE = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/
const VERSION_COMMENT_RE = /#\s*v\d+\S*\s*$/
const DIGEST_RE = /@sha256:[0-9a-f]{64}\s*$/

const USES_LINE_RE = /^\s*-?\s*uses:\s*(\S+)(.*)$/
const IMAGE_LINE_RE = /^(\s*)image:\s*(\S+)(.*)$/
const KEY_LINE_RE = /^(\s*)-?\s*([\w-]+):\s*$/

const violations = []
let checked = 0

const fail = (file, lineNo, message) =>
  violations.push(`  ✗ ${file}:${lineNo} — ${message}`)

for (const name of readdirSync(WORKFLOWS_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .sort()) {
  const rel = `.github/workflows/${name}`
  const lines = readFileSync(join(WORKFLOWS_DIR, name), 'utf8').split('\n')

  // Indent-stack of ancestor keys, so `image:` under a step's `with:` (an
  // input of an already SHA-pinned action, e.g. the locally-built image name
  // handed to sbom/scan actions) is not mistaken for a service/job container.
  const ancestors = []

  for (const [i, line] of lines.entries()) {
    const lineNo = i + 1
    const indent = line.match(/^\s*/)[0].length
    if (line.trim() !== '' && !line.trim().startsWith('#')) {
      while (ancestors.length > 0 && ancestors[ancestors.length - 1].indent >= indent) {
        ancestors.pop()
      }
    }
    const inWith = ancestors.some((a) => a.key === 'with')

    const uses = USES_LINE_RE.exec(line)
    if (uses) {
      const [, ref, rest] = uses
      checked++
      if (ref.startsWith('./')) {
        // same-repo composite action — no external supply chain
      } else if (ref.startsWith('docker://')) {
        const image = ref.slice('docker://'.length)
        if (!DIGEST_RE.test(image)) {
          fail(
            rel,
            lineNo,
            `docker:// action "${image}" is not digest-pinned (@sha256:<64hex>)`,
          )
        }
      } else if (!SHA_RE.test(ref)) {
        fail(
          rel,
          lineNo,
          `action "${ref}" is not pinned to a full 40-char lowercase commit SHA (owner/repo@<sha> # vX.Y.Z)`,
        )
      } else if (!VERSION_COMMENT_RE.test(rest)) {
        fail(
          rel,
          lineNo,
          `action "${ref}" is missing its trailing \`# v…\` version comment`,
        )
      }
      continue
    }

    const image = IMAGE_LINE_RE.exec(line)
    if (image && !inWith) {
      const [, , ref] = image
      checked++
      if (!DIGEST_RE.test(ref)) {
        fail(
          rel,
          lineNo,
          `container image "${ref}" is not digest-pinned (name:tag@sha256:<64hex>)`,
        )
      }
    }

    const key = KEY_LINE_RE.exec(line)
    if (key) ancestors.push({ indent: key[1].length, key: key[2] })
  }
}

if (violations.length > 0) {
  console.error(`[action-pins] FAILED — ${violations.length} violation(s):`)
  for (const v of violations) console.error(v)
  console.error(
    '[action-pins] pin every action to a commit SHA with a `# v…` comment and every ' +
      'container image to a sha256 digest — see docs/operations/security-ci-policy.md',
  )
  process.exit(1)
}

console.log(`[action-pins] OK — ${checked} action/image reference(s) fully pinned`)
