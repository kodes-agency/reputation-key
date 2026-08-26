'use client'

import * as React from 'react'

type InputValue = string[] | string

interface VisuallyHiddenInputProps<T = InputValue> extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'checked' | 'onReset'
> {
  value?: T
  checked?: boolean
  control: HTMLElement | null
  bubbles?: boolean
}

function VisuallyHiddenInput<T = InputValue>(props: VisuallyHiddenInputProps<T>) {
  const {
    control,
    value,
    checked,
    bubbles = true,
    type = 'hidden',
    style,
    ...inputProps
  } = props
  const isCheckInput = type === 'checkbox' || type === 'radio'
  const serializedValue =
    typeof value === 'object' && value !== null ? JSON.stringify(value) : value
  const currentValue = isCheckInput ? checked : serializedValue
  const inputRef = React.useRef<HTMLInputElement>(null)
  const previousValueRef = React.useRef(currentValue)
  const [measurement, setMeasurement] = React.useState<{
    control: HTMLElement
    width: number
    height: number
  } | null>(null)

  React.useLayoutEffect(() => {
    if (!control) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const borderSize = Array.isArray(entry.borderBoxSize)
        ? entry.borderBoxSize[0]
        : entry.borderBoxSize
      setMeasurement({
        control,
        width: borderSize?.inlineSize ?? control.offsetWidth,
        height: borderSize?.blockSize ?? control.offsetHeight,
      })
    })
    observer.observe(control, { box: 'border-box' })
    return () => observer.disconnect()
  }, [control])

  React.useEffect(() => {
    const previousValue = previousValueRef.current
    previousValueRef.current = currentValue
    if (Object.is(previousValue, currentValue)) return
    inputRef.current?.dispatchEvent(
      new Event(isCheckInput ? 'click' : 'input', { bubbles }),
    )
  }, [bubbles, currentValue, isCheckInput])

  const controlSize =
    measurement?.control === control
      ? { width: measurement.width, height: measurement.height }
      : {}

  return (
    <input
      type={type}
      {...inputProps}
      ref={inputRef}
      aria-hidden={isCheckInput}
      tabIndex={-1}
      checked={isCheckInput ? checked : undefined}
      value={isCheckInput ? undefined : (serializedValue as string | number | undefined)}
      readOnly
      style={{
        ...style,
        ...controlSize,
        border: 0,
        clip: 'rect(0 0 0 0)',
        clipPath: 'inset(50%)',
        height: '1px',
        margin: '-1px',
        overflow: 'hidden',
        padding: 0,
        position: 'absolute',
        whiteSpace: 'nowrap',
        width: '1px',
      }}
    />
  )
}

export { VisuallyHiddenInput }
