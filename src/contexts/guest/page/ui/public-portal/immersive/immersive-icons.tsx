import type { ReactNode } from 'react'

// The few outline glyphs the response cards need, drawn inline so the guest
// chunk carries no icon library. All are decorative: the text beside each one
// carries the meaning, so they are hidden from assistive technology.

type IconProps = Readonly<{ size?: number; className?: string }>

function Outline({
  size = 18,
  className,
  children,
}: IconProps & Readonly<{ children: ReactNode }>) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

export const LockIcon = (props: IconProps) => (
  <Outline {...props}>
    <rect x="5" y="11" width="14" height="9" rx="2.5" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Outline>
)

export const ArrowUpRightIcon = (props: IconProps) => (
  <Outline {...props}>
    <path d="M7 17 17 7" />
    <path d="M8 7h9v9" />
  </Outline>
)

export const InfoIcon = (props: IconProps) => (
  <Outline {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </Outline>
)

export const AlertIcon = (props: IconProps) => (
  <Outline {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4.5" />
    <path d="M12 16h.01" />
  </Outline>
)

export const PencilIcon = (props: IconProps) => (
  <Outline {...props}>
    <path d="M15.5 4.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
  </Outline>
)

export const CheckIcon = (props: IconProps) => (
  <Outline {...props}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Outline>
)

export const ChevronDownIcon = (props: IconProps) => (
  <Outline {...props}>
    <path d="m6 9 6 6 6-6" />
  </Outline>
)

export const RestartIcon = (props: IconProps) => (
  <Outline {...props}>
    <path d="M4 12a8 8 0 1 0 2.3-5.6" />
    <path d="M4 4v4h4" />
  </Outline>
)
