type NumericField = Readonly<{
  name: string
  state: Readonly<{ value: number }>
  handleChange: (value: number) => void
}>

export function PortalFeedbackThresholdField({
  field,
  id,
  disabled,
  description,
}: Readonly<{
  field: NumericField
  id: string
  disabled?: boolean
  description: string
}>) {
  return (
    <label className="block space-y-2 text-sm" htmlFor={id}>
      <span className="font-medium">Private feedback threshold</span>
      <select
        id={id}
        name={field.name}
        value={field.state.value}
        disabled={disabled}
        onChange={(event) => field.handleChange(Number(event.target.value))}
        className="block w-full rounded-md border bg-background px-3 py-2"
      >
        {[1, 2, 3, 4, 5].map((value) => (
          <option key={value} value={value}>
            {value} star{value === 1 ? '' : 's'} or below
          </option>
        ))}
      </select>
      <span className="block text-muted-foreground">{description}</span>
    </label>
  )
}
