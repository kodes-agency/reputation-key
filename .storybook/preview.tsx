// Storybook preview — imports the app's design-system styles (Tailwind v4 +
// shadcn tokens). Theme is parameter-driven (BQC-6.8): stories default to the
// dark theme the product ships with; a story opts into light with
// `parameters: { theme: 'light' }` (axe runs on those variants too — the dark
// primary was tuned for dark contrast, so light surfaces need their own proof).
import type { Preview } from '@storybook/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import '../src/styles.css'
import '../src/shared/auth/permissions' // side-effect: initPermissionTable() for can()
import { RouterDecorator } from './RouterDecorator'

// Per-story QueryClient (BQC-6.8): a module-level singleton leaked cached
// queries across stories (identical query keys + staleTime/gcTime Infinity —
// the Pages/Inbox LongContent story was served the PREVIOUS story's list).
// One client per story render keeps stories hermetic while preserving the
// shared-across-decorators behavior within a story (retry: false to avoid
// flakiness, staleTime high for stability).
function StoryQueryClientProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: Infinity,
            gcTime: Infinity,
          },
        },
      }),
  )
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const preview: Preview = {
  decorators: [
    // Provide QueryClient for components using TanStack Query (useSuspenseQuery, etc.).
    // Must wrap before router in some cases for query + route data.
    (Story) => (
      <StoryQueryClientProvider>
        <Story />
      </StoryQueryClientProvider>
    ),
    // Provide a TanStack memory router so components using useRouter()/
    // useNavigate()/useRouterState() (anything via useMutationAction) render.
    RouterDecorator,
    // Apply the theme class + color-scheme so shadcn primitives render in the
    // right theme. Dark stays the default (the product ships dark-first per
    // PRODUCT.md, preserving every existing story's baseline); a story opts
    // into light with `parameters: { theme: 'light' }`.
    (Story, context) => {
      const theme = context.parameters.theme === 'light' ? 'light' : 'dark'
      document.documentElement.classList.remove('light', 'dark')
      document.documentElement.classList.add(theme)
      document.documentElement.style.colorScheme = theme
      return Story()
    },
  ],
  parameters: {
    viewport: {
      viewports: {
        mobileNarrow: {
          name: 'Mobile narrow',
          styles: { width: '320px', height: '900px' },
        },
        mobileStaff: {
          name: 'Mobile staff',
          styles: { width: '390px', height: '844px' },
        },
        tablet: { name: 'Tablet', styles: { width: '820px', height: '1180px' } },
        desktopManager: {
          name: 'Desktop manager',
          styles: { width: '1440px', height: '900px' },
        },
      },
    },
    a11y: {
      // test='error' makes `test-storybook` fail on violations. color-contrast
      // is enabled: the dark-theme --primary was darkened (oklch(0.62 → 0.56
      // 0.18 290), same hue/chroma) to clear WCAG AA at 5.00:1. The
      // landmark/heading/region rules don't apply to isolated component stories.
      test: 'error',
      config: {
        rules: [
          { id: 'landmark-one-main', enabled: false },
          { id: 'page-has-heading-one', enabled: false },
          { id: 'region', enabled: false },
          { id: 'landmark-no-duplicate-main', enabled: false },
          { id: 'landmark-main-is-top-level', enabled: false },
          { id: 'landmark-unique', enabled: false },
        ],
      },
    },
  },
}

export default preview
