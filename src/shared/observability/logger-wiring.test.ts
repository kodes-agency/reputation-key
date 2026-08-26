import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('logger dependency boundary', () => {
  it('keeps the optional pretty-printer out of production dependencies', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }

    expect(manifest.dependencies?.['pino-pretty']).toBeUndefined()
    expect(manifest.devDependencies?.['pino-pretty']).toBe('^13.1.3')
  })
})
