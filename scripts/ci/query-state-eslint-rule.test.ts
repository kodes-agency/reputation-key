import { ESLint, type Rule } from 'eslint'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'

const { default: rule }: { default: Rule.RuleModule } = await import(
  pathToFileURL(resolve('eslint-rules/query-state.mjs')).href
)
const RULE_ID = 'local/query-state'
// The rule alone, over the repository's TypeScript parser: where it is switched
// on is the lint config's business, not this test's.
const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ['**/*.{ts,tsx}'],
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      plugins: { local: { rules: { 'query-state': rule } } },
      rules: { [RULE_ID]: 'error' },
    },
  ],
})

async function messages(code: string, filePath = 'src/components/query-fixture.tsx') {
  const [result] = await eslint.lintText(code, { filePath })
  expect(result?.messages.filter(({ fatal }) => fatal)).toEqual([])
  return result?.messages.filter(({ ruleId }) => ruleId === RULE_ID) ?? []
}

describe('query-state lint rule', () => {
  it.each([
    "useQuery({ queryKey: ['portals', id] })",
    "useQuery({ 'queryKey': (['portals', id] as const) })",
    "const queryKey = ['portals', id]; useQuery({ queryKey })",
    "const key = ['portals', id]; useQuery({ queryKey: key })",
    "useQuery({ queryKey: [...['portals'], id] })",
    "useActionMutation(save, { invalidateKeys: [['portals', id]] })",
    "const keys = [['portals', id]]; useActionMutation(save, { invalidateKeys: [...keys] })",
    'useActionMutation(save, { invalidateKeys: [] })',
  ])('rejects a literal cache key: %s', async (code) => {
    expect(await messages(code)).toMatchObject([{ severity: 2 }])
  })

  it('accepts factory keys, generic delegates and scoped invalidation', async () => {
    expect(
      await messages(`
      useQuery({ queryKey: portalKeys.detail(id) })
      useQuery({ queryKey })
      useActionMutation(save, { invalidateKeys: [portalKeys.detail(id)] })
      const keys = [portalKeys.detail(id)]
      useActionMutation(save, { invalidateKeys: [...keys] })
      router.invalidate({ filter: match => match.id === id })
    `),
    ).toEqual([])
  })

  it('accepts a key built on an imported factory prefix', async () => {
    expect(
      await messages(`
      import { guestKeys as keys, identityKeys } from '#/shared/queries/query-keys'
      const { invalidateKeys } = options ?? {}
      useQuery({ queryKey: [...keys.all, 'unavailable-copy'] as const })
      useActionMutation(save, {
        invalidateKeys: [[...identityKeys.merchantAiNotice(), 'updates']],
      })
    `),
    ).toEqual([])
  })

  it('rejects whole-router invalidation on an ordinary screen', async () => {
    expect(await messages('router.invalidate()')).toMatchObject([{ severity: 2 }])
  })

  it.each(['src/routes/login.tsx', 'src/components/layout/use-guarded-route-error.tsx'])(
    'allows one whole-router invalidation in %s and no literal key',
    async (filePath) => {
      expect(await messages('router.invalidate()', filePath)).toEqual([])
      expect(
        await messages('router.invalidate(); router.invalidate()', filePath),
      ).toHaveLength(1)
      expect(
        await messages("useQuery({ queryKey: ['portals'] })", filePath),
      ).toHaveLength(1)
    },
  )
})
