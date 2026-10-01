import { AlertIcon } from './immersive-icons'

/** A message inside a card, announced when it appears. */
export function ImmersiveBanner({ message }: Readonly<{ message: string }>) {
  return (
    <p className="ih-banner" role="alert">
      <AlertIcon size={20} />
      <span>{message}</span>
    </p>
  )
}
