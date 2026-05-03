import {
  createRootRoute,
  HeadContent,
  Scripts,
  useRouterState,
} from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import Footer from '#/components/layout/Footer'
import Header from '#/components/layout/Header'
import { authClient } from '#/shared/auth/auth-client'
import { Toaster } from '#/components/ui/sonner'
import appCss from '#/styles.css?url'

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersLight=window.matchMedia('(prefers-color-scheme: light)').matches;var resolved=mode==='auto'?(prefersLight?'light':'dark'):mode;var root=document.documentElement;if(resolved==='light'){root.classList.add('light')}else{root.classList.remove('light')}root.style.colorScheme=resolved;}catch(e){}})();`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      { title: 'Reputation Key' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const showChrome = useRouterState({
    select: (s) => {
      const ids = s.matches.map((m) => m.routeId)
      return (
        !ids.includes('/_authenticated') && !ids.includes('/p/$propertySlug/$portalSlug')
      )
    },
  })

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="font-sans antialiased [overflow-wrap:anywhere] selection:bg-[rgba(79,184,178,0.24)]">
        {showChrome ? (
          <>
            <Header onSignOut={() => authClient.signOut()} />
            <main>{children}</main>
            <Footer />
          </>
        ) : (
          children
        )}
        <Toaster position="top-right" richColors closeButton />
        <Scripts />
        <TanStackRouterDevtools initialIsOpen={false} />
      </body>
    </html>
  )
}
