import { Link } from '@tanstack/react-router'
import { Separator } from '#/components/ui/separator'

export function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="mt-20 px-4 pb-14 pt-10">
      <Separator className="mb-10" />
      <div className="page-wrap flex flex-col items-center justify-between gap-4 text-center text-sm text-muted-foreground sm:flex-row sm:text-left">
        <p>&copy; {year} Reputation Key. All rights reserved.</p>
        <Link to="/privacy" className="font-medium underline underline-offset-4">
          Privacy notice
        </Link>
      </div>
    </footer>
  )
}
