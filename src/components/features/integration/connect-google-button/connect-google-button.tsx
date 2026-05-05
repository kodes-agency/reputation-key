import { Button } from '#/components/ui/button'
import { Link } from '@tanstack/react-router'

export function ConnectGoogleButton() {
  return (
    <Button asChild>
      {/* @ts-expect-error - Route will be registered after router codegen */}
      <Link to="/api/integration/google/auth">Connect Google Account</Link>
    </Button>
  )
}
