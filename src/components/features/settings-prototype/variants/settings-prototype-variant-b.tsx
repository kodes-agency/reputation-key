// PROTOTYPE — variant B (Settings home). STUB: replace the body of VariantB with the real layout.
// Keep the two exports below; variants/index.ts imports exactly these names.
import type { SettingsPrototypeVariantProps } from '../settings-prototype-types'
import { SettingsPrototypeVariantStub } from './settings-prototype-variant-stub'

export const VARIANT_B_NAME = 'Settings home'

export function VariantB({ ctx }: SettingsPrototypeVariantProps) {
  return <SettingsPrototypeVariantStub ctx={ctx} name={VARIANT_B_NAME} />
}
