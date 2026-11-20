import { AlertIcon } from './immersive-icons'

/** A message inside a card, announced when it appears. */
export function ImmersiveBanner({
  message,
  id,
}: Readonly<{ message: string; id?: string }>) {
  return (
    <p id={id} className="ih-banner" role="alert">
      <AlertIcon size={20} />
      <span>{message}</span>
    </p>
  )
}
