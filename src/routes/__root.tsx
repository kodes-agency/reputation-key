import {
  createRootRoute,
  HeadContent,
  Scripts,
  useRouterState,
} from '@tanstack/react-router'

import Footer from '#/components/layout/footer'
import Header from '#/components/layout/header'
import { authClient } from '#/shared/auth/auth-client'
import { Toaster } from '#/components/ui/sonner'
import appCss from '#/styles.css?url'

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);root.style.colorScheme=resolved;}catch(e){}})();`

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
      <body className="font-sans antialiased [overflow-wrap:anywhere] selection:bg-[oklch(0.78_0.14_75/0.25)]">
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
      </body>
    </html>
  )
}
