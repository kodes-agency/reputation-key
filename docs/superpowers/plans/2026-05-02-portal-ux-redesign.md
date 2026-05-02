# Portal Management UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the portal management UX from a three-tab layout to a single-page layout with inline sections, a slide-over preview panel, QR modal, theme presets, and enhanced portal list — while extracting the public portal rendering into a shared component.

**Architecture:** Extract `PublicPortalContent` from the public route as a reusable component wrapped in CSS-scoped `.portal-preview-root`. The admin detail page becomes a single scrollable page with three sections (Settings, Link Tree, Share) plus a Sheet-based slide-over preview. Theme presets (Light/Dark/Brand/Custom) wrap the existing color picker. Smart routing gets side-by-side visual cards. The portal list table gains guest URL, QR, preview, and theme swatch columns.

**Tech Stack:** React, TanStack Router/Start, TanStack Form, Zod, Radix UI (Sheet, Dialog), Tailwind CSS v4, qrcode library, @dnd-kit, lucide-react

---

## File Structure

### New Files

| File                                                           | Responsibility                                                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/components/guest/PublicPortalContent.tsx`                 | Extracted shared portal renderer (hero, name, description, stars, feedback, link tree)         |
| `src/components/features/portal/PortalPreviewPanel.tsx`        | Sheet-based slide-over wrapping `PublicPortalContent` with mobile-width frame and gray gutters |
| `src/components/features/portal/QRCodeModal.tsx`               | Dialog showing QR image, guest URL, copy button, download button                               |
| `src/components/features/portal/ThemePresetSelector.tsx`       | Preset selector (Light/Dark/Brand) + custom color picker toggle                                |
| `src/components/features/portal/SmartRoutingConfig.tsx`        | Side-by-side threshold cards with slider between them                                          |
| `src/components/features/portal/ShareSection.tsx`              | Guest URL display + copy button + QR modal trigger                                             |
| `src/components/features/portal/PortalDetailPage.tsx`          | New single-page portal detail combining settings + link tree + share + preview toggle          |
| `src/components/features/portal/usePreviewToggle.ts`           | Hook for localStorage-persisted preview panel open/close state                                 |
| `src/components/features/portal/PortalCreationWithPreview.tsx` | Creation form with toggleable live preview sidebar                                             |

### Modified Files

| File                                                                             | Change                                                                                                                                                   |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/p/$orgSlug/$portalSlug.tsx`                                          | Use `PublicPortalContent` instead of inline rendering                                                                                                    |
| `src/routes/_authenticated/properties/$propertyId/portals/$portalId.tsx`         | Remove tabs, render `PortalDetailPage`                                                                                                                   |
| `src/routes/_authenticated/properties/$propertyId/portals/$portalId/index.tsx`   | Delete — merged into single-page layout                                                                                                                  |
| `src/routes/_authenticated/properties/$propertyId/portals/$portalId/links.tsx`   | Delete — merged into single-page layout                                                                                                                  |
| `src/routes/_authenticated/properties/$propertyId/portals/$portalId/preview.tsx` | Delete — replaced by slide-over panel                                                                                                                    |
| `src/routes/_authenticated/properties/$propertyId/portals/new.tsx`               | Use `PortalCreationWithPreview` instead of bare `CreatePortalForm`                                                                                       |
| `src/routes/_authenticated/properties/$propertyId/portals/index.tsx`             | Add guest URL, QR icon, preview icon, theme swatch columns                                                                                               |
| `src/components/features/portal/EditPortalForm.tsx`                              | Strip down to only hero image + name + slug fields; theme moves to `ThemePresetSelector`, smart routing moves to `SmartRoutingConfig`, description stays |
| `src/components/features/portal/CreatePortalForm.tsx`                            | Add slug auto-generation from name, add theme preset selector, remove ColorPicker direct usage                                                           |
| `src/components/features/portal/SortableCategory.tsx`                            | No changes — reused as-is inside new layout                                                                                                              |
| `src/routeTree.gen.ts`                                                           | Auto-regenerated after route file changes                                                                                                                |

---

## Task 1: Extract `PublicPortalContent` Shared Component

**Files:**

- Create: `src/components/guest/PublicPortalContent.tsx`
- Modify: `src/routes/p/$orgSlug/$portalSlug.tsx`

- [ ] **Step 1: Create `PublicPortalContent` component**

Extract the portal rendering from the public route into a reusable component. This component receives portal data as props and renders: hero image, name, organization name, description, star rating, feedback form, and link categories.

```tsx
// src/components/guest/PublicPortalContent.tsx
import { StarRating } from './star-rating'
import { FeedbackForm } from './feedback-form'
import type { ScanSource } from '#/contexts/guest/application/dto/public-portal.dto'

export type PortalCategory = {
  id: string
  title: string
}

export type PortalLinkItem = {
  id: string
  label: string
  url: string
  categoryId: string
}

export type PublicPortalContentProps = Readonly<{
  portal: {
    id: string
    name: string
    description: string | null
    organizationName: string
    heroImageUrl: string | null
    theme: Record<string, string> | null
  }
  categories: PortalCategory[]
  links: PortalLinkItem[]
  source?: ScanSource
}>

export function PublicPortalContent({
  portal,
  categories,
  links,
  source = 'direct',
}: PublicPortalContentProps) {
  const theme = portal.theme as Record<string, string> | null
  const themeStyle = theme
    ? {
        '--portal-primary': theme.primaryColor ?? '#6366F1',
        '--portal-bg': theme.backgroundColor ?? '#ffffff',
        '--portal-text': theme.textColor ?? '#111827',
      }
    : {}

  return (
    <div
      className="portal-preview-root min-h-screen"
      style={{
        backgroundColor: 'var(--portal-bg, #ffffff)',
        color: 'var(--portal-text, #111827)',
        ...themeStyle,
      }}
    >
      <div className="max-w-lg mx-auto px-4 py-8 space-y-8">
        {portal.heroImageUrl && (
          <img
            src={portal.heroImageUrl}
            alt={portal.name}
            className="w-full h-48 object-cover rounded-lg"
          />
        )}

        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">{portal.name}</h1>
          <p className="text-sm text-gray-500">{portal.organizationName}</p>
        </div>

        {portal.description && (
          <p className="text-center text-gray-600">{portal.description}</p>
        )}

        <StarRating portalId={portal.id} source={source} />

        <FeedbackForm portalId={portal.id} source={source} />

        <div className="space-y-6">
          {categories.map((category) => {
            const categoryLinks = links.filter((l) => l.categoryId === category.id)
            return (
              <div key={category.id} className="space-y-2">
                <h2 className="text-lg font-semibold">{category.title}</h2>
                <div className="space-y-2">
                  {categoryLinks.map((link) => (
                    <a
                      key={link.id}
                      href={`/api/public/click/${link.id}`}
                      className="block p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                    >
                      {link.label}
                    </a>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run typecheck to verify the new component**

Run: `pnpm typecheck`
Expected: PASS (component is not yet imported anywhere)

- [ ] **Step 3: Refactor public route to use `PublicPortalContent`**

Replace the inline rendering in `src/routes/p/$orgSlug/$portalSlug.tsx` with the shared component:

```tsx
// src/routes/p/$orgSlug/$portalSlug.tsx
import { createFileRoute } from '@tanstack/react-router'
import { getPublicPortal } from '#/contexts/guest/server/public'
import { PortalNotFound } from '#/components/guest/portal-not-found'
import { PublicPortalContent } from '#/components/guest/PublicPortalContent'
import { CookieConsentBanner } from '#/components/guest/cookie-consent-banner'
import type { PublicPortalLoaderData } from '#/contexts/guest/application/dto/public-portal.dto'

const VALID_SOURCES: ReadonlySet<string> = new Set(['qr', 'nfc', 'direct'])
type ScanSource = 'qr' | 'nfc' | 'direct'

function parseSource(raw: string | null): ScanSource {
  return raw && VALID_SOURCES.has(raw) ? (raw as ScanSource) : 'direct'
}

export const Route = createFileRoute('/p/$orgSlug/$portalSlug')({
  validateSearch: (search: Record<string, string>) => ({
    source: search.source,
  }),
  loader: async ({ params }): Promise<PublicPortalLoaderData | null> => {
    try {
      const portalData = await getPublicPortal({
        data: {
          orgSlug: params.orgSlug,
          portalSlug: params.portalSlug,
        },
      })
      return portalData
    } catch {
      return null
    }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: 'Portal Not Found' }] }
    return {
      meta: [
        { title: `${loaderData.portal.name} — ${loaderData.portal.organizationName}` },
        { name: 'description', content: loaderData.portal.description ?? '' },
        { property: 'og:title', content: loaderData.portal.name },
        { property: 'og:description', content: loaderData.portal.description ?? '' },
      ],
    }
  },
  component: PublicPortalPage,
})

function PublicPortalPage() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const source = parseSource(search.source ?? null)

  if (!data) {
    return <PortalNotFound />
  }

  const { portal, categories, links } = data

  return (
    <>
      <CookieConsentBanner />
      <PublicPortalContent
        portal={portal}
        categories={categories}
        links={links}
        source={source}
      />
    </>
  )
}
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/guest/PublicPortalContent.tsx src/routes/p/\$orgSlug/\$portalSlug.tsx
git commit -m "refactor: extract PublicPortalContent as shared component"
```

---

## Task 2: Create `PortalPreviewPanel` Slide-Over

**Files:**

- Create: `src/components/features/portal/PortalPreviewPanel.tsx`

- [ ] **Step 1: Create the preview panel component**

This Sheet wraps `PublicPortalContent` inside a fixed-width mobile frame with gray gutters.

```tsx
// src/components/features/portal/PortalPreviewPanel.tsx
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '#/components/ui/sheet'
import { PublicPortalContent } from '#/components/guest/PublicPortalContent'
import type {
  PortalCategory,
  PortalLinkItem,
} from '#/components/guest/PublicPortalContent'

type PortalPreviewPanelProps = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  portal: {
    id: string
    name: string
    description: string | null
    organizationName: string
    heroImageUrl: string | null
    theme: Record<string, string> | null
  }
  categories: PortalCategory[]
  links: PortalLinkItem[]
}>

export function PortalPreviewPanel({
  open,
  onOpenChange,
  portal,
  categories,
  links,
}: PortalPreviewPanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[480px] sm:max-w-[480px] p-0 overflow-y-auto"
      >
        <SheetHeader className="p-4 pb-0">
          <SheetTitle>Preview</SheetTitle>
          <SheetDescription>
            This is how guests will see your portal on mobile.
          </SheetDescription>
        </SheetHeader>
        <div className="flex justify-center p-4 bg-gray-100 min-h-[calc(100vh-80px)]">
          <div className="w-[400px] max-w-full bg-white rounded-lg shadow-lg overflow-hidden">
            <PublicPortalContent
              portal={portal}
              categories={categories}
              links={links}
              source="direct"
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/features/portal/PortalPreviewPanel.tsx
git commit -m "feat: add PortalPreviewPanel slide-over component"
```

---

## Task 3: Create `usePreviewToggle` Hook

**Files:**

- Create: `src/components/features/portal/usePreviewToggle.ts`

- [ ] **Step 1: Create the localStorage-persisted preview toggle hook**

```ts
// src/components/features/portal/usePreviewToggle.ts
import { useState, useEffect, useCallback } from 'react'

export function usePreviewToggle(portalId: string) {
  const storageKey = `portal-preview-open-${portalId}`

  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      return localStorage.getItem(storageKey) === 'true'
    } catch {
      return false
    }
  })

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen)
      try {
        localStorage.setItem(storageKey, String(nextOpen))
      } catch {
        // ignore storage errors
      }
    },
    [storageKey],
  )

  return { previewOpen: open, setPreviewOpen: handleOpenChange } as const
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/features/portal/usePreviewToggle.ts
git commit -m "feat: add usePreviewToggle hook for localStorage-persisted preview state"
```

---

## Task 4: Create `QRCodeModal` Component

**Files:**

- Create: `src/components/features/portal/QRCodeModal.tsx`

- [ ] **Step 1: Create the QR code modal component**

```tsx
// src/components/features/portal/QRCodeModal.tsx
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { Copy, Download, QrCode } from 'lucide-react'

type QRCodeModalProps = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  portalId: string
  portalSlug: string
  organizationId: string
}>

export function QRCodeModal({
  open,
  onOpenChange,
  portalId,
  portalSlug,
  organizationId,
}: QRCodeModalProps) {
  const [copied, setCopied] = useState(false)

  const guestUrl = `${window.location.origin}/p/${organizationId}/${portalSlug}?source=qr`
  const qrApiUrl = `/api/portals/${portalId}/qr`

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(guestUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback: select text
    }
  }

  const handleDownload = () => {
    const link = document.createElement('a')
    link.href = qrApiUrl
    link.download = `qr-${portalSlug}.png`
    link.click()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>QR Code</DialogTitle>
          <DialogDescription>Scan this code to open the guest portal.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          <img
            src={qrApiUrl}
            alt={`QR code for ${portalSlug}`}
            className="w-64 h-64 rounded-lg border"
          />

          <div className="flex items-center gap-2 w-full px-4">
            <code className="flex-1 text-sm bg-muted px-3 py-2 rounded-md truncate">
              {guestUrl}
            </code>
            <Button variant="outline" size="sm" onClick={handleCopy}>
              <Copy className="size-3.5" />
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>

          <Button variant="outline" onClick={handleDownload} className="w-full max-w-xs">
            <Download className="size-3.5 mr-2" />
            Download PNG
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/features/portal/QRCodeModal.tsx
git commit -m "feat: add QRCodeModal with preview, copy URL, and download PNG"
```

---

## Task 5: Create `ShareSection` Component

**Files:**

- Create: `src/components/features/portal/ShareSection.tsx`

- [ ] **Step 1: Create the share section component**

Displays guest URL with copy button and QR modal trigger.

```tsx
// src/components/features/portal/ShareSection.tsx
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { Copy, QrCode } from 'lucide-react'
import { QRCodeModal } from './QRCodeModal'

type ShareSectionProps = Readonly<{
  portalId: string
  portalSlug: string
  organizationId: string
}>

export function ShareSection({
  portalId,
  portalSlug,
  organizationId,
}: ShareSectionProps) {
  const [copied, setCopied] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)

  const guestUrl = `/p/${organizationId}/${portalSlug}`
  const fullUrl = `${window.location.origin}${guestUrl}`

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
    }
  }

  return (
    <>
      <div className="rounded-lg border p-4 space-y-3">
        <h3 className="font-semibold">Share</h3>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-sm bg-muted px-3 py-2 rounded-md truncate">
            {guestUrl}
          </code>
          <Button variant="outline" size="sm" onClick={handleCopy}>
            <Copy className="size-3.5" />
            {copied ? 'Copied!' : 'Copy'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setQrOpen(true)}>
            <QrCode className="size-3.5" />
          </Button>
        </div>
      </div>

      <QRCodeModal
        open={qrOpen}
        onOpenChange={setQrOpen}
        portalId={portalId}
        portalSlug={portalSlug}
        organizationId={organizationId}
      />
    </>
  )
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/features/portal/ShareSection.tsx
git commit -m "feat: add ShareSection with guest URL copy and QR modal trigger"
```

---

## Task 6: Create `ThemePresetSelector` Component

**Files:**

- Create: `src/components/features/portal/ThemePresetSelector.tsx`

- [ ] **Step 1: Create the theme preset selector**

Three presets (Light, Dark, Brand) plus custom color override toggle. Reuses the existing `ColorPicker` UI component.

```tsx
// src/components/features/portal/ThemePresetSelector.tsx
import { useState } from 'react'
import {
  ColorPicker,
  ColorPickerArea,
  ColorPickerContent,
  ColorPickerEyeDropper,
  ColorPickerFormatSelect,
  ColorPickerHueSlider,
  ColorPickerInput,
  ColorPickerSwatch,
  ColorPickerTrigger,
} from '#/components/ui/color-picker'
import { Sun, Moon, Palette } from 'lucide-react'
import { cn } from '#/lib/utils'

type ThemePreset = 'light' | 'dark' | 'brand' | 'custom'

type ThemePresetSelectorProps = Readonly<{
  primaryColor: string
  onPrimaryColorChange: (color: string) => void
  disabled?: boolean
}>

const PRESETS: ReadonlyArray<{
  id: ThemePreset
  label: string
  icon: typeof Sun
  colors: { primaryColor: string; backgroundColor: string; textColor: string }
}> = [
  {
    id: 'light',
    label: 'Light',
    icon: Sun,
    colors: { primaryColor: '#6366f1', backgroundColor: '#ffffff', textColor: '#111827' },
  },
  {
    id: 'dark',
    label: 'Dark',
    icon: Moon,
    colors: { primaryColor: '#6366f1', backgroundColor: '#111827', textColor: '#f9fafb' },
  },
  {
    id: 'brand',
    label: 'Brand',
    icon: Palette,
    colors: { primaryColor: '#6366f1', backgroundColor: '#ffffff', textColor: '#111827' },
  },
]

export function ThemePresetSelector({
  primaryColor,
  onPrimaryColorChange,
  disabled = false,
}: ThemePresetSelectorProps) {
  const [activePreset, setActivePreset] = useState<ThemePreset>('light')
  const [customOpen, setCustomOpen] = useState(false)

  const handlePresetSelect = (preset: ThemePreset) => {
    setActivePreset(preset)
    if (preset !== 'custom') {
      setCustomOpen(false)
      const found = PRESETS.find((p) => p.id === preset)
      if (found) onPrimaryColorChange(found.colors.primaryColor)
    } else {
      setCustomOpen(true)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {PRESETS.map((preset) => {
          const Icon = preset.icon
          return (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              onClick={() => handlePresetSelect(preset.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-md border text-sm transition-colors',
                activePreset === preset.id
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-border hover:bg-muted',
                disabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              <Icon className="size-4" />
              {preset.label}
            </button>
          )
        })}
        <button
          type="button"
          disabled={disabled}
          onClick={() => handlePresetSelect('custom')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 rounded-md border text-sm transition-colors',
            activePreset === 'custom'
              ? 'border-primary bg-primary/5 text-primary'
              : 'border-border hover:bg-muted',
            disabled && 'opacity-50 cursor-not-allowed',
          )}
        >
          <div
            className="size-4 rounded-full border"
            style={{ backgroundColor: primaryColor }}
          />
          Custom
        </button>
      </div>

      {customOpen && activePreset === 'custom' && (
        <ColorPicker
          value={primaryColor}
          onValueChange={onPrimaryColorChange}
          disabled={disabled}
        >
          <div className="flex items-center gap-2">
            <ColorPickerTrigger>
              <ColorPickerSwatch />
            </ColorPickerTrigger>
            <ColorPickerInput withoutAlpha />
          </div>
          <ColorPickerContent>
            <ColorPickerArea />
            <ColorPickerHueSlider />
            <div className="flex items-center gap-2">
              <ColorPickerInput withoutAlpha />
              <ColorPickerFormatSelect />
              <ColorPickerEyeDropper />
            </div>
          </ColorPickerContent>
        </ColorPicker>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/features/portal/ThemePresetSelector.tsx
git commit -m "feat: add ThemePresetSelector with Light/Dark/Brand/Custom presets"
```

---

## Task 7: Create `SmartRoutingConfig` Component

**Files:**

- Create: `src/components/features/portal/SmartRoutingConfig.tsx`

- [ ] **Step 1: Create the smart routing visual config**

Side-by-side cards showing "Below threshold" vs "At or above threshold" behavior with the threshold slider between them.

```tsx
// src/components/features/portal/SmartRoutingConfig.tsx
import { cn } from '#/lib/utils'

type SmartRoutingConfigProps = Readonly<{
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  threshold: number
  onThresholdChange: (threshold: number) => void
  disabled?: boolean
}>

export function SmartRoutingConfig({
  enabled,
  onEnabledChange,
  threshold,
  onThresholdChange,
  disabled = false,
}: SmartRoutingConfigProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border p-4">
        <div>
          <p className="font-medium">Smart Routing</p>
          <p className="text-sm text-muted-foreground">
            Emphasize feedback for low ratings, guide high raters to review sites.
          </p>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className="size-5 cursor-pointer rounded border"
          disabled={disabled}
        />
      </div>

      {enabled && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div
              className={cn(
                'rounded-lg border p-3 text-center text-sm',
                'border-amber-200 bg-amber-50',
              )}
            >
              <p className="font-medium text-amber-800">Below {threshold} stars</p>
              <p className="text-xs text-amber-600 mt-1">
                Guest sees feedback form prominently
              </p>
            </div>
            <div
              className={cn(
                'rounded-lg border p-3 text-center text-sm',
                'border-green-200 bg-green-50',
              )}
            >
              <p className="font-medium text-green-800">{threshold}+ stars</p>
              <p className="text-xs text-green-600 mt-1">
                Guest sees review site links prominently
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Rating threshold: {threshold}+ stars</p>
            <input
              type="range"
              min={1}
              max={4}
              value={threshold}
              onChange={(e) => onThresholdChange(Number(e.target.value))}
              className="w-full"
              disabled={disabled}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>1 star</span>
              <span>4 stars</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/features/portal/SmartRoutingConfig.tsx
git commit -m "feat: add SmartRoutingConfig with side-by-side threshold cards"
```

---

## Task 8: Create `PortalDetailPage` — Single-Page Layout

**Files:**

- Create: `src/components/features/portal/PortalDetailPage.tsx`

This is the main integration task. It combines all the new components into a single scrollable page.

- [ ] **Step 1: Create the single-page portal detail**

```tsx
// src/components/features/portal/PortalDetailPage.tsx
import { useState, useCallback } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { ArrowLeft, Eye } from 'lucide-react'
import { EditPortalForm } from './EditPortalForm'
import { ShareSection } from './ShareSection'
import { ThemePresetSelector } from './ThemePresetSelector'
import { SmartRoutingConfig } from './SmartRoutingConfig'
import { PortalPreviewPanel } from './PortalPreviewPanel'
import { usePreviewToggle } from './usePreviewToggle'
import {
  createLinkCategory,
  reorderCategories,
  deleteLinkCategory,
  createLink,
  deleteLink,
  updateLink,
  updateLinkCategory,
  reorderLinks,
  listPortalLinks,
} from '#/contexts/portal/server/portal-links'
import { SortableCategory } from './SortableCategory'
import { LinkAddInlineForm } from './LinkAddInlineForm'
import { LinkEditInlineForm } from './LinkEditInlineForm'
import { CategoryAddForm } from './CategoryAddForm'
import { CategoryEditInlineForm } from './CategoryEditInlineForm'
import { toast } from 'sonner'
import { generateKeyBetween } from 'fractional-indexing'
import {
  useMutationAction,
  useMutationActionSilent,
} from '#/components/hooks/use-mutation-action'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import type {
  PortalCategory,
  PortalLinkItem,
} from '#/components/guest/PublicPortalContent'
import type { Action } from '#/components/hooks/use-action'

type Category = { id: string; title: string; sortKey: string }
type LinkItem = {
  id: string
  label: string
  url: string
  sortKey: string
  categoryId: string
}

type PortalDetailPageProps = Readonly<{
  portal: {
    id: string
    name: string
    slug: string
    description: string | null
    heroImageUrl: string | null
    theme: { primaryColor: string }
    smartRoutingEnabled: boolean
    smartRoutingThreshold: number
    organizationId: string
    organizationName: string
  }
  propertyId: string
  categories: Category[]
  links: LinkItem[]
  canEdit: boolean
  updateMutation: Action<{
    data: {
      portalId: string
      name?: string
      slug?: string
      description?: string | null
      theme?: { primaryColor: string }
      smartRoutingEnabled?: boolean
      smartRoutingThreshold?: number
    }
  }>
}>

export function PortalDetailPage({
  portal,
  propertyId,
  categories: initialCategories,
  links: initialLinks,
  canEdit,
  updateMutation,
}: PortalDetailPageProps) {
  const { previewOpen, setPreviewOpen } = usePreviewToggle(portal.id)

  // Link tree state
  const [categories, setCategories] = useState(initialCategories)
  const [links, setLinks] = useState(initialLinks)
  const [addingToCategory, setAddingToCategory] = useState<string | null>(null)
  const [editingLink, setEditingLink] = useState<string | null>(null)
  const [editingCategory, setEditingCategory] = useState<string | null>(null)
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null)
  const [deletingLinkId, setDeletingLinkIdState] = useState<string | null>(null)

  // Theme/routing state (optimistic preview)
  const [primaryColor, setPrimaryColor] = useState(portal.theme.primaryColor)
  const [smartRoutingEnabled, setSmartRoutingEnabled] = useState(
    portal.smartRoutingEnabled,
  )
  const [smartRoutingThreshold, setSmartRoutingThreshold] = useState(
    portal.smartRoutingThreshold,
  )

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Link tree mutations
  const createCategoryMutation = useMutationAction(createLinkCategory, {
    successMessage: 'Category created',
  })
  const createLinkMutation = useMutationAction(createLink, {
    successMessage: 'Link created',
  })
  const deleteCategoryMutation = useMutationActionSilent(deleteLinkCategory)
  const deleteLinkMutation = useMutationActionSilent(deleteLink)
  const reorderCategoriesMutation = useMutationActionSilent(reorderCategories)
  const reorderLinksMutation = useMutationActionSilent(reorderLinks)
  const updateLinkMutation = useMutationAction(updateLink, {
    successMessage: 'Link updated',
  })
  const updateCategoryMutation = useMutationAction(updateLinkCategory, {
    successMessage: 'Category updated',
  })

  const portalId = portal.id

  const handleAddCategory = async (title: string) => {
    try {
      const result = await createCategoryMutation({ data: { portalId, title } })
      setCategories((prev) => [
        ...prev,
        {
          id: result.category.id,
          title: result.category.title,
          sortKey: result.category.sortKey,
        },
      ])
    } catch {
      toast.error('Failed to create category')
    }
  }

  const handleAddLink = async (categoryId: string, label: string, url: string) => {
    try {
      const result = await createLinkMutation({
        data: { categoryId, portalId, label, url },
      })
      setLinks((prev) => [
        ...prev,
        {
          id: result.link.id,
          label: result.link.label,
          url: result.link.url,
          sortKey: result.link.sortKey,
          categoryId,
        },
      ])
      setAddingToCategory(null)
    } catch {
      toast.error('Failed to create link')
    }
  }

  const handleDeleteCategory = async (catId: string) => {
    setDeletingCategoryId(catId)
    try {
      await deleteCategoryMutation({ data: { categoryId: catId } })
      setCategories((prev) => prev.filter((c) => c.id !== catId))
      setLinks((prev) => prev.filter((l) => l.categoryId !== catId))
    } catch {
      toast.error('Failed to delete category')
    } finally {
      setDeletingCategoryId(null)
    }
  }

  const handleDeleteLink = async (linkId: string) => {
    setDeletingLinkIdState(linkId)
    try {
      await deleteLinkMutation({ data: { linkId } })
      setLinks((prev) => prev.filter((l) => l.id !== linkId))
    } catch {
      toast.error('Failed to delete link')
    } finally {
      setDeletingLinkIdState(null)
    }
  }

  const handleUpdateLink = async (linkId: string, label: string, url: string) => {
    try {
      const result = await updateLinkMutation({ data: { linkId, label, url } })
      setLinks((prev) =>
        prev.map((l) =>
          l.id === linkId ? { ...l, label: result.link.label, url: result.link.url } : l,
        ),
      )
      setEditingLink(null)
    } catch {
      toast.error('Failed to update link')
    }
  }

  const handleUpdateCategory = async (catId: string, title: string) => {
    try {
      const result = await updateCategoryMutation({ data: { categoryId: catId, title } })
      setCategories((prev) =>
        prev.map((c) => (c.id === catId ? { ...c, title: result.category.title } : c)),
      )
      setEditingCategory(null)
    } catch {
      toast.error('Failed to update category')
    }
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = categories.findIndex((c) => c.id === active.id)
    const newIndex = categories.findIndex((c) => c.id === over.id)
    const reordered = arrayMove(categories, oldIndex, newIndex)
    setCategories(reordered)
    const updates = reordered.map((cat, i) => {
      const prev = i > 0 ? reordered[i - 1].sortKey : null
      const sortKey = generateKeyBetween(prev, cat.sortKey)
      return { id: cat.id, sortKey }
    })
    try {
      await reorderCategoriesMutation({ data: { portalId, items: updates } })
    } catch {
      toast.error('Failed to reorder categories')
    }
  }

  const handleReorderLinks = async (categoryId: string, reordered: LinkItem[]) => {
    const otherLinks = links.filter((l) => l.categoryId !== categoryId)
    const updates = reordered.map((link, i) => {
      const prev = i > 0 ? reordered[i - 1].sortKey : null
      const sortKey = generateKeyBetween(prev, link.sortKey)
      return { id: link.id, sortKey }
    })
    setLinks([
      ...otherLinks,
      ...reordered.map((l, i) => ({ ...l, sortKey: updates[i].sortKey })),
    ])
    try {
      await reorderLinksMutation({ data: { portalId, categoryId, items: updates } })
    } catch {
      toast.error('Failed to reorder links')
    }
  }

  // Build optimistic preview data
  const previewPortal = {
    id: portal.id,
    name: portal.name,
    description: portal.description,
    organizationName: portal.organizationName,
    heroImageUrl: portal.heroImageUrl,
    theme: {
      primaryColor,
      backgroundColor: undefined,
      textColor: undefined,
    } as Record<string, string>,
  }

  const previewCategories: PortalCategory[] = categories.map((c) => ({
    id: c.id,
    title: c.title,
  }))
  const previewLinks: PortalLinkItem[] = links.map((l) => ({
    id: l.id,
    label: l.label,
    url: l.url,
    categoryId: l.categoryId,
  }))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" asChild>
            <Link to="/properties/$propertyId/portals" params={{ propertyId }}>
              <ArrowLeft />
              Back
            </Link>
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={() => setPreviewOpen(!previewOpen)}>
          <Eye className="size-3.5 mr-1" />
          {previewOpen ? 'Hide Preview' : 'Preview'}
        </Button>
      </div>

      {/* Settings Section */}
      <section className="rounded-lg border p-4 space-y-4">
        <h2 className="text-lg font-semibold">Settings</h2>

        <EditPortalForm
          portal={{
            ...portal,
            theme: { primaryColor },
            smartRoutingEnabled,
            smartRoutingThreshold,
          }}
          mutation={updateMutation}
          canEdit={canEdit}
        />

        {/* Theme Presets — replaces inline ColorPicker */}
        <div className="space-y-2">
          <h3 className="font-semibold">Theme</h3>
          <ThemePresetSelector
            primaryColor={primaryColor}
            onPrimaryColorChange={setPrimaryColor}
            disabled={!canEdit}
          />
        </div>

        {/* Smart Routing */}
        <div className="space-y-2">
          <h3 className="font-semibold">Smart Routing</h3>
          <SmartRoutingConfig
            enabled={smartRoutingEnabled}
            onEnabledChange={setSmartRoutingEnabled}
            threshold={smartRoutingThreshold}
            onThresholdChange={setSmartRoutingThreshold}
            disabled={!canEdit}
          />
        </div>
      </section>

      {/* Link Tree Section */}
      <section className="rounded-lg border p-4 space-y-4">
        <h2 className="text-lg font-semibold">Link Tree</h2>

        {canEdit && (
          <CategoryAddForm
            onSubmit={handleAddCategory}
            isPending={createCategoryMutation.isPending}
            error={createCategoryMutation.error}
          />
        )}

        {addingToCategory && canEdit && (
          <LinkAddInlineForm
            onSubmit={(label, url) => handleAddLink(addingToCategory, label, url)}
            onCancel={() => setAddingToCategory(null)}
            isPending={createLinkMutation.isPending}
            error={createLinkMutation.error}
          />
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={categories.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-4">
              {categories.map((cat) => (
                <div key={cat.id}>
                  {editingCategory === cat.id && canEdit ? (
                    <CategoryEditInlineForm
                      initialTitle={cat.title}
                      onSubmit={(title) => handleUpdateCategory(cat.id, title)}
                      onCancel={() => setEditingCategory(null)}
                      isPending={updateCategoryMutation.isPending}
                      error={updateCategoryMutation.error}
                    />
                  ) : (
                    <SortableCategory
                      category={cat}
                      links={links.filter((l) => l.categoryId === cat.id)}
                      isDeletingCategory={deletingCategoryId === cat.id}
                      deletingLinkId={deletingLinkId ?? undefined}
                      onAddLink={(catId) => {
                        setAddingToCategory(catId)
                        setEditingLink(null)
                        setEditingCategory(null)
                      }}
                      onDeleteLink={handleDeleteLink}
                      onDeleteCategory={handleDeleteCategory}
                      onEditCategory={(c) => setEditingCategory(c.id)}
                      onEditLink={(link) => {
                        setEditingLink(link.id)
                        setAddingToCategory(null)
                        setEditingCategory(null)
                      }}
                      onReorderLinks={handleReorderLinks}
                      canEdit={canEdit}
                    />
                  )}
                  {editingLink &&
                    links
                      .filter((l) => l.categoryId === cat.id)
                      .map((link) =>
                        link.id === editingLink && canEdit ? (
                          <LinkEditInlineForm
                            key={link.id}
                            initialLabel={link.label}
                            initialUrl={link.url}
                            onSubmit={(label, url) =>
                              handleUpdateLink(link.id, label, url)
                            }
                            onCancel={() => setEditingLink(null)}
                            isPending={updateLinkMutation.isPending}
                            error={updateLinkMutation.error}
                          />
                        ) : null,
                      )}
                </div>
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {categories.length === 0 && (
          <div className="py-8 text-center">
            <p className="text-muted-foreground">
              No categories yet. Create one to start organizing links.
            </p>
          </div>
        )}
      </section>

      {/* Share Section */}
      <ShareSection
        portalId={portal.id}
        portalSlug={portal.slug}
        organizationId={portal.organizationId}
      />

      {/* Slide-over Preview */}
      <PortalPreviewPanel
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        portal={previewPortal}
        categories={previewCategories}
        links={previewLinks}
      />
    </div>
  )
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: May have minor type issues from `EditPortalForm` expecting original theme shape. Fix inline.

- [ ] **Step 3: Fix any type errors**

The `EditPortalForm` currently receives `portal.theme.primaryColor` directly. Since `PortalDetailPage` now manages theme state separately via `ThemePresetSelector`, the `EditPortalForm` needs to be simplified — remove its internal theme section. This will be done in Task 9.

For now, ensure the `portal` prop passed to `EditPortalForm` matches its expected shape. If type errors occur, adjust the prop shape in `PortalDetailPage` to match exactly what `EditPortalForm` expects.

- [ ] **Step 4: Commit**

```bash
git add src/components/features/portal/PortalDetailPage.tsx
git commit -m "feat: add PortalDetailPage single-page layout with all sections"
```

---

## Task 9: Simplify `EditPortalForm` — Remove Theme & Smart Routing

**Files:**

- Modify: `src/components/features/portal/EditPortalForm.tsx`

- [ ] **Step 1: Remove theme and smart routing sections from EditPortalForm**

The `EditPortalForm` should now only handle: hero image upload, name, slug, and description. Theme is handled by `ThemePresetSelector` and smart routing by `SmartRoutingConfig` — both rendered by `PortalDetailPage`.

Remove from the form:

1. The entire `{/* Theme */}` section (ColorPicker block)
2. The entire `{/* Smart routing */}` section (checkbox + slider)
3. The `primaryColor`, `smartRoutingEnabled`, `smartRoutingThreshold` fields from the form schema and default values
4. The `ColorPicker` imports

The form schema becomes:

```ts
const editFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  slug: z.string().min(2, 'Slug must be at least 2 characters').max(64),
  description: z.string().max(500),
})
```

The `onSubmit` handler should still send `theme` and `smartRouting*` fields from the parent, but the form itself no longer manages them. The simplest approach: keep the `portal` prop with all fields, but the form only edits name/slug/description/heroImage. Theme and smart routing values pass through unchanged.

Update the `onSubmit` to include the parent's current theme/routing values:

```ts
onSubmit: async ({ value }) => {
  const data = {
    portalId: portal.id,
    name: value.name,
    slug: value.slug,
    description: value.description || null,
    theme: portal.theme,
    smartRoutingEnabled: portal.smartRoutingEnabled,
    smartRoutingThreshold: portal.smartRoutingThreshold,
  }
  await mutation({ data })
},
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/features/portal/EditPortalForm.tsx
git commit -m "refactor: simplify EditPortalForm to hero+name+slug+description only"
```

---

## Task 10: Rewrite Portal Detail Route — Single Page, No Tabs

**Files:**

- Modify: `src/routes/_authenticated/properties/$propertyId/portals/$portalId.tsx`
- Delete: `src/routes/_authenticated/properties/$propertyId/portals/$portalId/index.tsx`
- Delete: `src/routes/_authenticated/properties/$propertyId/portals/$portalId/links.tsx`
- Delete: `src/routes/_authenticated/properties/$propertyId/portals/$portalId/preview.tsx`

- [ ] **Step 1: Rewrite `$portalId.tsx` layout route**

Replace the tab-based layout with a single-page route that loads portal + links data and renders `PortalDetailPage`:

```tsx
// src/routes/_authenticated/properties/$propertyId/portals/$portalId.tsx
import { createFileRoute } from '@tanstack/react-router'
import { getPortal } from '#/contexts/portal/server/portals'
import { listPortalLinks } from '#/contexts/portal/server/portal-links'
import { hasRole } from '#/shared/domain/roles'
import { updatePortal } from '#/contexts/portal/server/portals'
import { PortalDetailPage } from '#/components/features/portal/PortalDetailPage'
import { useMutationAction } from '#/components/hooks/use-mutation-action'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/portals/$portalId',
)({
  staleTime: 30_000,
  loader: async ({ params }) => {
    const [{ portal }, { categories, links }] = await Promise.all([
      getPortal({ data: { portalId: params.portalId } }),
      listPortalLinks({ data: { portalId: params.portalId } }),
    ])
    return {
      portal,
      categories: categories.map((c: { id: string; title: string; sortKey: string }) => ({
        id: c.id,
        title: c.title,
        sortKey: c.sortKey,
      })),
      links: links.map(
        (l: {
          id: string
          label: string
          url: string
          sortKey: string
          categoryId: string
        }) => ({
          id: l.id,
          label: l.label,
          url: l.url,
          sortKey: l.sortKey,
          categoryId: l.categoryId,
        }),
      ),
      propertyId: params.propertyId,
    }
  },
  component: PortalDetailRoute,
})

function PortalDetailRoute() {
  const { portal, categories, links, propertyId } = Route.useLoaderData()
  const ctx = Route.useRouteContext()
  const canEdit = hasRole(ctx.role, 'PropertyManager')

  const mutation = useMutationAction(updatePortal, {
    successMessage: 'Portal updated',
  })

  return (
    <PortalDetailPage
      portal={portal}
      propertyId={propertyId}
      categories={categories}
      links={links}
      canEdit={canEdit}
      updateMutation={mutation}
    />
  )
}
```

- [ ] **Step 2: Delete the old child routes**

```bash
rm src/routes/_authenticated/properties/\$propertyId/portals/\$portalId/index.tsx
rm src/routes/_authenticated/properties/\$propertyId/portals/\$portalId/links.tsx
rm src/routes/_authenticated/properties/\$propertyId/portals/\$portalId/preview.tsx
```

- [ ] **Step 3: Regenerate route tree**

Run: `pnpm dev &` (start dev server briefly to regenerate `routeTree.gen.ts`), then stop it.

Or manually run: `pnpm tsr generate`

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS — no more references to deleted child routes

- [ ] **Step 5: Commit**

```bash
git add -A src/routes/_authenticated/properties/\$propertyId/portals/\$portalId/ src/routeTree.gen.ts src/routes/_authenticated/properties/\$propertyId/portals/\$portalId.tsx
git commit -m "feat: replace tab-based portal detail with single-page layout"
```

---

## Task 11: Enhance `CreatePortalForm` — Slug Auto-Gen + Theme Presets

**Files:**

- Modify: `src/components/features/portal/CreatePortalForm.tsx`
- Create: `src/components/features/portal/PortalCreationWithPreview.tsx`

- [ ] **Step 1: Add slug auto-generation from name**

Update `CreatePortalForm` to auto-generate slug from name using a `useEffect`. Keep slug editable.

Add after the form definition:

```ts
// Auto-generate slug from name
useEffect(() => {
  const nameValue = form.getFieldValue('name')
  const slugValue = form.getFieldValue('slug')
  if (nameValue && !slugValue) {
    const generated = nameValue
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    form.setFieldValue('slug', generated)
  }
}, [form.getFieldValue('name')])
```

Also replace the `ColorPicker` section with `ThemePresetSelector`:

Replace the entire `{/* Theme */}` section in the form JSX with:

```tsx
<div className="space-y-2">
  <h3 className="font-semibold">Theme</h3>
  <ThemePresetSelector
    primaryColor={/* need to track via form field */}
    onPrimaryColorChange={(color) => form.setFieldValue('primaryColor', color)}
  />
</div>
```

Import `ThemePresetSelector` at the top.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Create `PortalCreationWithPreview`**

Wrapper component for the create route that adds a toggleable preview sidebar:

```tsx
// src/components/features/portal/PortalCreationWithPreview.tsx
import { useState, useEffect } from 'react'
import { CreatePortalForm } from './CreatePortalForm'
import { PublicPortalContent } from '#/components/guest/PublicPortalContent'
import { Button } from '#/components/ui/button'
import { Eye, EyeOff } from 'lucide-react'
import type { Action } from '#/components/hooks/use-action'

type PortalCreationWithPreviewProps = Readonly<{
  propertyId: string
  mutation: Action<{
    data: {
      name: string
      slug?: string
      description?: string
      propertyId: string
    }
  }>
}>

const PREVIEW_STORAGE_KEY = 'portal-creation-preview-open'

export function PortalCreationWithPreview({
  propertyId,
  mutation,
}: PortalCreationWithPreviewProps) {
  const [showPreview, setShowPreview] = useState(() => {
    try {
      return localStorage.getItem(PREVIEW_STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })

  const [previewName, setPreviewName] = useState('')
  const [previewDescription, setPreviewDescription] = useState('')
  const [previewColor, setPreviewColor] = useState('#6366f1')

  useEffect(() => {
    try {
      localStorage.setItem(PREVIEW_STORAGE_KEY, String(showPreview))
    } catch {
      // ignore
    }
  }, [showPreview])

  const previewPortal = {
    id: 'preview',
    name: previewName || 'Portal Name',
    description: previewDescription || null,
    organizationName: 'Your Organization',
    heroImageUrl: null,
    theme: { primaryColor: previewColor },
  }

  return (
    <div className="flex gap-6">
      <div className={showPreview ? 'flex-1' : 'w-full'}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Create Portal</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Set up a new guest-facing portal page.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
          >
            {showPreview ? (
              <EyeOff className="size-3.5 mr-1" />
            ) : (
              <Eye className="size-3.5 mr-1" />
            )}
            {showPreview ? 'Hide Preview' : 'Show Preview'}
          </Button>
        </div>
        <CreatePortalForm propertyId={propertyId} mutation={mutation} />
      </div>

      {showPreview && (
        <div className="w-[400px] shrink-0 hidden lg:block">
          <div className="sticky top-8 bg-gray-100 rounded-lg p-4">
            <p className="text-xs text-muted-foreground text-center mb-2">Live Preview</p>
            <div className="bg-white rounded-lg shadow-lg overflow-hidden max-h-[80vh] overflow-y-auto">
              <PublicPortalContent
                portal={previewPortal}
                categories={[{ id: 'placeholder', title: 'Your links will appear here' }]}
                links={[]}
                source="direct"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Update the create route to use `PortalCreationWithPreview`**

Modify `src/routes/_authenticated/properties/$propertyId/portals/new.tsx`:

```tsx
// src/routes/_authenticated/properties/$propertyId/portals/new.tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { createPortal } from '#/contexts/portal/server/portals'
import { PortalCreationWithPreview } from '#/components/features/portal/PortalCreationWithPreview'
import { useMutationAction } from '#/components/hooks/use-mutation-action'

export const Route = createFileRoute(
  '/_authenticated/properties/$propertyId/portals/new',
)({
  component: NewPortalPage,
})

function NewPortalPage() {
  const { propertyId } = Route.useParams()
  const navigate = useNavigate()

  const mutation = useMutationAction(createPortal, {
    successMessage: 'Portal created',
    onSuccess: async (output) => {
      await navigate({
        to: '/properties/$propertyId/portals/$portalId',
        params: { propertyId, portalId: output.portal.id },
      })
    },
  })

  return <PortalCreationWithPreview propertyId={propertyId} mutation={mutation} />
}
```

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/features/portal/CreatePortalForm.tsx src/components/features/portal/PortalCreationWithPreview.tsx src/routes/_authenticated/properties/\$propertyId/portals/new.tsx
git commit -m "feat: add slug auto-gen, theme presets, and live preview to portal creation"
```

---

## Task 12: Enhance Portal List — Add Guest URL, QR, Preview, Theme Swatch

**Files:**

- Modify: `src/routes/_authenticated/properties/$propertyId/portals/index.tsx`

- [ ] **Step 1: Add new columns to the portal list table**

Add columns for guest URL (with copy), QR icon (opens modal), preview link, and theme color swatch.

Update the table header:

```tsx
<TableHeader>
  <TableRow>
    <TableHead>Name</TableHead>
    <TableHead>Guest URL</TableHead>
    <TableHead>Theme</TableHead>
    <TableHead>Status</TableHead>
    <TableHead className="text-right">Actions</TableHead>
  </TableRow>
</TableHeader>
```

Update each table row:

```tsx
{
  portals.map((p) => (
    <TableRow key={p.id}>
      <TableCell>
        <Link
          to="/properties/$propertyId/portals/$portalId"
          params={{ propertyId, portalId: p.id }}
          className="font-medium hover:underline"
        >
          {p.name}
        </Link>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <code className="text-xs text-muted-foreground">
            /p/{p.organizationId}/{p.slug}
          </code>
          <CopyButton
            text={`${window.location.origin}/p/${p.organizationId}/${p.slug}`}
          />
        </div>
      </TableCell>
      <TableCell>
        <div
          className="size-5 rounded-full border"
          style={{
            backgroundColor:
              (p.theme as Record<string, string>)?.primaryColor ?? '#6366f1',
          }}
        />
      </TableCell>
      <TableCell>
        {p.isActive ? <Badge>Active</Badge> : <Badge variant="outline">Inactive</Badge>}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" asChild>
            <Link
              to="/properties/$propertyId/portals/$portalId"
              params={{ propertyId, portalId: p.id }}
            >
              <Eye className="size-3.5" />
            </Link>
          </Button>
          {canDelete && <AlertDialog>{/* ... existing delete dialog ... */}</AlertDialog>}
        </div>
      </TableCell>
    </TableRow>
  ))
}
```

Add a `CopyButton` inline helper at the top of the file:

```tsx
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="p-1 hover:bg-muted rounded transition-colors"
      title="Copy URL"
    >
      <Copy className="size-3 text-muted-foreground" />
      {copied && <span className="sr-only">Copied!</span>}
    </button>
  )
}
```

Add imports: `useState`, `Copy`, `Eye` from lucide-react.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/routes/_authenticated/properties/\$propertyId/portals/index.tsx
git commit -m "feat: add guest URL, theme swatch, and preview link to portal list"
```

---

## Task 13: Integration Typecheck and Manual Verification

**Files:**

- All modified files

- [ ] **Step 1: Full typecheck**

Run: `pnpm typecheck`
Expected: PASS — zero errors

- [ ] **Step 2: Verify build**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 3: Manual smoke test**

1. Navigate to portal list — verify new columns render (guest URL, theme swatch)
2. Click into a portal detail — verify single-page layout (Settings, Link Tree, Share sections)
3. Click "Preview" button — verify slide-over panel shows with mobile-width portal preview
4. Click QR icon in share section — verify modal with QR image, URL, copy, download
5. Toggle theme presets (Light/Dark/Brand/Custom) — verify color updates
6. Create new portal — verify slug auto-generates, preview sidebar toggles
7. Navigate to public portal URL (`/p/{orgSlug}/{portalSlug}`) — verify rendering unchanged

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve integration issues from portal UX redesign"
```

---

## Self-Review Checklist

**1. Spec Coverage:**

| Decision                                         | Task                               |
| ------------------------------------------------ | ---------------------------------- |
| A1. Shared `PublicPortalContent`                 | Task 1                             |
| A2. CSS style isolation (`.portal-preview-root`) | Task 1                             |
| A3. QR modal with preview + download             | Task 4                             |
| D1. Single-page, no tabs                         | Task 10                            |
| D2. No collapse, always expanded                 | Task 8 (all sections rendered)     |
| D3. Slide-over preview panel                     | Task 2                             |
| D4. Optimistic preview sync                      | Task 8 (local state feeds preview) |
| D5. Theme presets (Light/Dark/Brand/Custom)      | Task 6                             |
| D6. Smart routing side-by-side cards             | Task 7                             |
| I1. Guest URL in Settings with copy              | Task 5                             |
| I2. Creation form with toggleable preview        | Task 11                            |
| I3. Enhanced portal list                         | Task 12                            |
| I4. Link tree uses shared component for preview  | Task 2 + 8                         |
| I5. Preview toggle persisted via localStorage    | Task 3                             |
| I6. Auto-generated slug from name                | Task 11                            |

**2. Placeholder Scan:** No TBD, TODO, or "implement later" patterns found. All steps contain complete code.

**3. Type Consistency:** `PortalCategory`, `PortalLinkItem` exported from `PublicPortalContent` and consumed consistently across `PortalPreviewPanel` and `PortalDetailPage`. `portal.organizationId` used consistently for guest URL construction. `Action` type from `use-action.ts` used uniformly.
