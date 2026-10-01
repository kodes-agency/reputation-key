/**
 * The bot trap of the guest forms: a field a person never sees or reaches and
 * a bot fills in. Hidden from assistive technology and the tab order; the
 * server rejects a response that carries a value.
 */
export function ImmersiveHoneypot({
  id,
  label,
  value,
  onChange,
}: Readonly<{
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}>) {
  return (
    <div aria-hidden="true" className="ih-honeypot">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name="website"
        type="text"
        tabIndex={-1}
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
