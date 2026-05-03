import { useNavigate } from '@tanstack/react-router'
import { ChevronsUpDown, LogOut, Moon, Sun, Monitor, Plus } from 'lucide-react'
import { SidebarTrigger } from '#/components/ui/sidebar'
import { Button } from '#/components/ui/button'
import { Separator } from '#/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { authClient } from '#/shared/auth/auth-client'
import { usePropertyId } from '#/components/hooks/use-property-id'
import { useEffect, useState } from 'react'

type ThemeMode = 'light' | 'dark' | 'auto'

type Props = Readonly<{
  user: { id: string; name: string; email: string; image: string | null }
  properties: ReadonlyArray<{ id: string; name: string; slug: string }>
}>

function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>('auto')

  useEffect(() => {
    const stored = window.localStorage.getItem('theme')
    if (stored === 'light' || stored === 'dark' || stored === 'auto') {
      setMode(stored)
    }
  }, [])

  function applyMode(next: ThemeMode) {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const resolved = next === 'auto' ? (prefersDark ? 'dark' : 'light') : next

    document.documentElement.classList.remove('light', 'dark')
    document.documentElement.classList.add(resolved)

    if (next === 'auto') {
      document.documentElement.removeAttribute('data-theme')
    } else {
      document.documentElement.setAttribute('data-theme', next)
    }

    document.documentElement.style.colorScheme = resolved
    window.localStorage.setItem('theme', next)
    setMode(next)
  }

  return { mode, applyMode } as const
}

export function AppTopBar({ user, properties }: Props) {
  const propertyId = usePropertyId()
  const navigate = useNavigate()
  const { mode, applyMode } = useThemeMode()

  const currentProperty = properties.find((p) => p.id === propertyId)

  function handlePropertySwitch(id: string) {
    navigate({
      to: '/properties/$propertyId',
      params: { propertyId: id },
    })
  }

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
      <Separator orientation="vertical" className="mr-2 h-4" />

      {/* Property switcher — always visible */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="gap-2 px-2">
            <span className="text-sm font-medium">
              {currentProperty?.name ?? 'Select property'}
            </span>
            <ChevronsUpDown className="size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {properties.map((p) => (
            <DropdownMenuItem key={p.id} onClick={() => handlePropertySwitch(p.id)}>
              {p.name}
              {p.id === propertyId && (
                <span className="ml-auto text-xs text-muted-foreground">Active</span>
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate({ to: '/properties/new' })}>
            <Plus className="size-3.5 mr-1" />
            Add Property
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
