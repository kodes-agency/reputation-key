import {
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { Footer } from '#/components/layout/footer'
import { Header } from '#/components/layout/header'
import { initWebVitals } from '#/components/hooks/web-vitals'
import { authClient } from '#/shared/auth/auth-client'
import { Toaster } from '#/components/ui/sonner'
import appCss from '#/styles.css?url'
import { notificationFns } from '#/routes/-notification-fns'
import { clearTenantCacheAfterSessionEnd } from '#/shared/queries/tenant-cache-transition'
import { getBrowserObservabilityConfigFn } from '#/shared/observability/browser-observability.server'

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);root.style.colorScheme=resolved;}catch(e){}})();`

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  loader: () => getBrowserObservabilityConfigFn(),
  head: ({ loaderData }) => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      { title: 'Reputation Key' },
      ...(loaderData
        ? [
            { name: 'repkey-sentry-dsn', content: loaderData.dsn },
            { name: 'repkey-sentry-release', content: loaderData.release },
            { name: 'repkey-sentry-environment', content: loaderData.environment },
          ]
        : []),
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const cspNonce = router.options.ssr?.nonce

  const showChrome = useRouterState({
    select: (s) => {
      const ids = s.matches.map((m) => m.routeId)
      return !ids.includes('/_authenticated') && !ids.includes('/p/$token')
    },
  })

  // The public guest Portal is rendered ENTIRELY in the guest's locale — it
  // carries none of the app chrome (see showChrome above), so a document that
  // keeps claiming English misdescribes every word on it. `lang` is not
  // decoration: it selects the screen-reader voice, offers the right
  // translation prompt, and drives hyphenation.
  const documentLanguage = useRouterState({
    select: (s) => {
      const portalMatch = s.matches.find((m) => m.routeId === '/p/$token')
      const locale = (
        portalMatch?.loaderData as
          { localization?: { selectedLocale?: string } } | undefined
      )?.localization?.selectedLocale
      return locale === 'bg' ? 'bg' : 'en'
    },
  })

  // BQC-6.8: Core Web Vitals collection (LCP + CLS). Runs client-side only
  // (useEffect never fires during SSR); initWebVitals is a no-op without
  // PerformanceObserver support.
  useEffect(() => {
    initWebVitals()
  }, [])

  return (
    <html lang={documentLanguage} suppressHydrationWarning>
      <head>
        {/* The CSP nonce only exists on the server, and browsers scrub the `nonce`
            content attribute from the DOM once the document is parsed (HTML spec
            nonce-hiding), so the client always reads it back as "". Hydration can
            therefore never match here — suppress it on this one element rather than
            let every page log "A tree hydrated but some attributes … didn't match".
            `suppressHydrationWarning` on <html> does not cover descendants. */}
        <script
          nonce={cspNonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <HeadContent />
      </head>
      <body className="font-sans antialiased [overflow-wrap:anywhere] selection:bg-[oklch(0.42_0.18_290/0.25)]">
        {showChrome ? (
          <>
            <Header
              onSignOut={() => {
                void clearTenantCacheAfterSessionEnd(
                  router.options.context.queryClient,
                  () => authClient.signOut(),
                )
              }}
              notificationFns={notificationFns}
            />
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
