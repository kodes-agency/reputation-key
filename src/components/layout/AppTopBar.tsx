import { useNavigate } from '@tanstack/react-router'
import { LogOut, Moon, Sun, Monitor } from 'lucide-react'
import { SidebarTrigger } from '#/components/ui/sidebar'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { authClient } from '#/shared/auth/auth-client'
import { useState } from 'react'

type ThemeMode = 'light' | 'dark' | 'auto'

function readStoredMode(): ThemeMode {
  const stored = window.localStorage.getItem('theme')
  if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored
  return 'auto'
}

type Props = Readonly<{
  user: { id: string; name: string; email: string; image: string | null }
}>

function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>(readStoredMode)

  function applyMode(next: ThemeMode) {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const resolved = next === 'auto' ? (prefersDark ? 'dark' : 'light') : next

    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(resolved)
    root.style.colorScheme = resolved

    window.localStorage.setItem('theme', next)
    setMode(next)
  }

  return { mode, applyMode } as const
}

export function AppTopBar({ user }: Props) {
  const navigate = useNavigate()
  const { mode, applyMode } = useThemeMode()

  const ThemeIcon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor

  const initials = user.name
    ? user.name
        .split(' ')
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'U'

  return (
    <header className="flex h-13 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />

      <div className="flex-1" />

      {/* User menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="rounded-full">
            {user.image ? (
              <img src={user.image} alt="" className="size-7 rounded-full object-cover" />
            ) : (
              <div className="flex size-7 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                {initials}
              </div>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium">{user.name}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() =>
              applyMode(mode === 'dark' ? 'light' : mode === 'light' ? 'auto' : 'dark')
            }
          >
            <ThemeIcon className="size-4" />
            {mode === 'dark'
              ? 'Light mode'
              : mode === 'light'
                ? 'System theme'
                : 'Dark mode'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={async () => {
              await authClient.signOut()
              await navigate({ to: '/login' })
            }}
          >
            <LogOut className="size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
