import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const CLASSIFIER_REFERENCE =
  /ai-(?:review-language|language-script|reply-language|zh-orthography)|cld3-asm|opencc-js/

describe('AI language server-only boundary', () => {
  it('keeps classifier code, data, WASM, and generated tables out of browser entry graphs', () => {
    const violations: string[] = []
    for (const directory of ['src/routes', 'src/components']) {
      for (const relativePath of globSync('**/*.{ts,tsx}', {
        cwd: resolve(ROOT, directory),
      })) {
        const path = `${directory}/${relativePath}`
        if (CLASSIFIER_REFERENCE.test(readFileSync(resolve(ROOT, path), 'utf8')))
          violations.push(path)
      }
    }
    expect(violations).toEqual([])
  })

  it('keeps opencc-js confined to the build-only orthography generator', () => {
    for (const path of [
      'src/shared/ai-zh-orthography-verifier.ts',
      'src/shared/ai-reply-language-verifier.ts',
      'src/shared/generated/ai-zh-orthography-v1.ts',
    ]) {
      expect(readFileSync(resolve(ROOT, path), 'utf8')).not.toContain("from 'opencc-js")
    }
    expect(
      readFileSync(resolve(ROOT, 'scripts/generate-ai-zh-orthography-table.ts'), 'utf8'),
    ).toContain("from 'opencc-js/cn2t'")
  })
})
