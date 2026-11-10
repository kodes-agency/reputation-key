import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

// Exercise the real config, including each rule's scope and primitive exceptions.
// Severity promotion is supplied separately because the owner protects the config.
const eslint = new ESLint()
const component = 'src/components/layout/policy-fixture.tsx'
const route = 'src/routes/_authenticated/policy-fixture.tsx'

async function violations(code: string, filePath = component) {
  const [result] = await eslint.lintText(code, { filePath })
  if (!result) throw new Error(`ESLint did not inspect ${filePath}`)
  expect(result.messages.filter(({ fatal }) => fatal)).toEqual([])
  return result.messages
    .filter(({ ruleId }) => ruleId?.startsWith('ui-pattern/'))
    .map(({ ruleId }) => ruleId)
}

// Tailwind reads test sources too; constructing forbidden classes keeps the
// planted violations out of the application's generated stylesheet.
const smallHeight = ['h', '6'].join('-')
const palette = ['text', 'red', '500'].join('-')
const importantInk = ['text', 'negative'].join('-')

describe('retained UI lint policies', () => {
  it.each([component, route])('rejects a raw action in %s', async (filePath) => {
    expect(await violations('<button type="button">Save</button>', filePath)).toEqual([
      'ui-pattern/raw-button',
    ])
    expect(await violations('<Button>Save</Button>', filePath)).toEqual([])
  })

  it.each([
    'src/components/features/beta-feedback/beta-feedback-choice.tsx',
    'src/contexts/portal/look/ui/focal-point-picker.tsx',
  ])(
    'still rejects an ordinary raw action beside a bespoke picker in %s',
    async (filePath) => {
      expect(await violations('<button type="button">Save</button>', filePath)).toEqual([
        'ui-pattern/raw-button',
      ])
    },
  )

  it.each(['picker-tile', 'picker-handle'])(
    'rejects a copied %s exception marker outside its named file',
    async (slot) => {
      expect(await violations(`<button data-slot="${slot}" />`)).toEqual([
        'ui-pattern/raw-button',
      ])
    },
  )

  it.each([
    'Button',
    'IconButton',
    'SubmitButton',
    'Input',
    'SelectTrigger',
    'DropdownMenuItem',
    'RowActionsItem',
    'ConfirmationTrigger',
  ])('rejects a caller overriding %s control size', async (name) => {
    expect(await violations(`<${name} className="md:${smallHeight}" />`)).toEqual([
      'ui-pattern/control-size',
    ])
    expect(await violations(`<${name} size="sm" />`)).toEqual([])
  })

  it.each([component, route])('rejects a palette colour in %s', async (filePath) => {
    expect(await violations(`const tone = "dark:${palette}/80"`, filePath)).toEqual([
      'ui-pattern/palette-colour',
    ])
    expect(await violations('const tone = "text-negative"', filePath)).toEqual([])
  })

  it('also rejects a palette colour in a template', async () => {
    expect(await violations(`const tone = \`hover:${palette}\``)).toEqual([
      'ui-pattern/palette-colour',
    ])
  })

  it.each([`!${importantInk}`, `${importantInk}!`])(
    'rejects important text ink: %s',
    async (ink) => {
      expect(await violations(`<a className="${ink}">Open</a>`)).toEqual([
        'ui-pattern/important-ink',
      ])
      expect(await violations('<a className="text-negative">Open</a>')).toEqual([])
    },
  )

  it('rejects important text ink in a template', async () => {
    expect(await violations(`const ink = \`md:!${importantInk}\``)).toEqual([
      'ui-pattern/important-ink',
    ])
  })

  it('rejects a page redirecting to the account-without-workspace state', async () => {
    expect(await violations("throw redirect({ to: '/unavailable' })", route)).toEqual([
      'ui-pattern/unavailable-redirect',
    ])
    expect(
      await violations("throw routeNotice({ title: 'Unavailable' })", route),
    ).toEqual([])
  })

  it.each([
    "if (!can(role, 'goal.read')) throw redirect({ to: '/properties' })",
    "if (!can(role, 'goal.read')) { throw redirect({ to: '/properties' }) }",
  ])('rejects a silent role-denial redirect: %s', async (code) => {
    expect(await violations(code, route)).toEqual(['ui-pattern/role-denial-redirect'])
    expect(
      await violations(
        "if (!can(role, 'goal.read')) throw roleUnavailable('Goals', '/properties')",
        route,
      ),
    ).toEqual([])
  })

  it('preserves a non-permission navigation redirect', async () => {
    expect(
      await violations("if (!id) throw redirect({ to: '/properties' })", route),
    ).toEqual([])
  })

  it.each(['src/routes/_authenticated.tsx', 'src/routes/unavailable.tsx'])(
    'preserves the workspace-entry redirect in %s',
    async (filePath) => {
      expect(
        await violations("throw redirect({ to: '/unavailable' })", filePath),
      ).toEqual([])
    },
  )

  it('leaves control construction to shared primitives', async () => {
    expect(
      await violations(
        `<><button /><Button className="${smallHeight}" /></>`,
        'src/components/ui/button.tsx',
      ),
    ).toEqual([])
  })

  it('preserves the guest renderer colour and raw-button exceptions', async () => {
    expect(
      await violations(
        `<button className="${palette}" />`,
        'src/components/features/guest/policy-fixture.tsx',
      ),
    ).toEqual([])
  })

  it('preserves the destructive menu glyph ink exception', async () => {
    expect(
      await violations(
        `const ink = "!${importantInk}"`,
        'src/components/ui/dropdown-menu.tsx',
      ),
    ).toEqual([])
  })

  it.each([
    'src/components/layout/policy-fixture.test.tsx',
    'src/components/layout/policy-fixture.stories.tsx',
    'src/components/layout/__fixtures__/policy-fixture.tsx',
    'src/components/layout/policy-fixtures.tsx',
  ])('does not treat %s as product UI', async (filePath) => {
    expect(
      await violations(`<button className="${palette} !${importantInk}" />`, filePath),
    ).toEqual([])
  })
})
