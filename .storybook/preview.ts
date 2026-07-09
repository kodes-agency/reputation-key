// Storybook preview — imports the app's design-system styles (Tailwind v4 +
// shadcn tokens) and applies dark theme by default (per PRODUCT.md).
import type { Preview } from '@storybook/react'
import '../src/styles.css'
import '../src/shared/auth/permissions' // side-effect: initPermissionTable() for can()
import { RouterDecorator } from './RouterDecorator'

const preview: Preview = {
  decorators: [
    // Provide a TanStack memory router so components using useRouter()/
    // useNavigate()/useRouterState() (anything via useMutationAction) render.
    RouterDecorator,
    // Apply the `.dark` class + color-scheme so shadcn primitives render in
    // the dark theme the product ships with.
    (Story) => {
      document.documentElement.classList.add('dark')
      document.documentElement.style.colorScheme = 'dark'
      return Story()
    },
  ],
  parameters: {
    viewport: {
      viewports: {
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
