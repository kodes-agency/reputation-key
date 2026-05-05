import { Button } from '#/components/ui/button'
import { Link } from '@tanstack/react-router'

export function ConnectGoogleButton() {
  return (
    <Button asChild>
      <Link to="/api/integration/google/auth">Connect Google Account</Link>
    </Button>
  )
}
