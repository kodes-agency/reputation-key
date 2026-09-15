import { expect, within } from 'storybook/test'

type Canvas = ReturnType<typeof within>

/**
 * What choosing "Local safe template" asks the suggestion function for: the
 * professional tone, the property default language, template only, and a fresh
 * idempotency key. Shared by the compose editor and composer stories.
 */
export const LOCAL_SAFE_TEMPLATE_REQUEST = [
  'professional',
  { kind: 'property_default' },
  true,
  expect.any(String),
] as const

/**
 * Exactly 4,096 UTF-8 bytes, Google's reply limit: the counter reads full and
 * stays neutral. Shared by the draft and published-edit stories, which then
 * assert their own action is allowed.
 */
export function expectNeutralCounterAtTheByteLimit(canvas: Canvas): void {
  const counter = canvas.getByText('4096/4096')
  expect(counter).toHaveClass('text-muted-foreground')
  expect(counter).not.toHaveClass('text-destructive')
}
