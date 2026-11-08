import { readFileSync } from 'node:fs'
import { URL } from 'node:url'

// Keep the existing no-growth ceilings until their owners split the files.
// New files, including shared UI primitives, all use the common limit.
const baseline = JSON.parse(
  readFileSync(
    new URL('../scripts/ci/file-length.baseline.json', import.meta.url),
    'utf8',
  ),
)
const options = (max) => ['error', { max, skipBlankLines: true, skipComments: true }]
const ignores = ['**/*.{test,spec,stories}.*', '**/generated/**', 'src/routeTree.gen.ts']

export default [
  {
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.{ts,mjs}', 'server/**/*.{ts,tsx}'],
    ignores,
    rules: { 'max-lines': options(800) },
  },
  ...Object.entries(baseline).map(([file, max]) => ({
    files: [file],
    ignores,
    rules: { 'max-lines': options(max) },
  })),
]
