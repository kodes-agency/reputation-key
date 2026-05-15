import type { BaseFieldApi } from '#/components/forms/form-text-field'

/**
 * Generic helper — describes a form-like object that has a typed Field component.
 * Used to slim down prop types in card components that only need `form.Field`.
 */
export type FormWithField<TFieldValues extends Record<string, unknown>> = {
  Field: React.FC<{
    name: keyof TFieldValues & string
    children: (field: BaseFieldApi) => React.ReactNode
  }>
}
