import type { BaseFieldApi } from '#/components/forms/form-text-field'

/** Describes a form-like object that has a typed Field component. */
export type FormWithField<TFieldValues extends Record<string, unknown>> = {
  Field: React.FC<{
    name: keyof TFieldValues & string
    children: (field: BaseFieldApi) => React.ReactNode
  }>
}
