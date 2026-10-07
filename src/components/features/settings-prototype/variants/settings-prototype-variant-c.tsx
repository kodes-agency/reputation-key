// PROTOTYPE — variant C (In the app sidebar). STUB: replace the body of VariantC with the real layout.
// Keep the two exports below; variants/index.ts imports exactly these names.
import type { SettingsPrototypeVariantProps } from '../settings-prototype-types'
import { SettingsPrototypeVariantStub } from './settings-prototype-variant-stub'

export const VARIANT_C_NAME = 'In the app sidebar'

export function VariantC({ ctx }: SettingsPrototypeVariantProps) {
  return <SettingsPrototypeVariantStub ctx={ctx} name={VARIANT_C_NAME} />
}
