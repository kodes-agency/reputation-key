// PROTOTYPE — variant A (Editor rail). STUB: replace the body of VariantA with the real layout.
// Keep the two exports below; variants/index.ts imports exactly these names.
import type { SettingsPrototypeVariantProps } from '../settings-prototype-types'
import { SettingsPrototypeVariantStub } from './settings-prototype-variant-stub'

export const VARIANT_A_NAME = 'Editor rail'

export function VariantA({ ctx }: SettingsPrototypeVariantProps) {
  return <SettingsPrototypeVariantStub ctx={ctx} name={VARIANT_A_NAME} />
}
