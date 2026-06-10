# UI Primitives & Forms Review

**Scope:** `src/components/ui/`, `src/components/forms/`
**Date:** 2026-06-10

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| MAJOR    | 3     |
| MINOR    | 4     |
| NIT      | 2     |

---

## Findings

### [ACCESSIBILITY] MAJOR DropZone is not keyboard accessible — interactive div has no role, tabIndex, or onKeyDown

File: src/components/forms/image-upload-field/drop-zone.tsx:41
Quote: ```tsx

  <div
    onDragOver={onDragOver}
    onDragLeave={onDragLeave}
    onDrop={onDrop}
    onClick={onClick}
    className={cn(
  ```
  Rule:  REUI.md (Base UI / accessibility), WCAG 2.1 SC 2.1.1
  Fix:   Add `role="button"`, `tabIndex={0}`, and `onKeyDown` handler (Enter/Space → onClick) to the DropZone wrapper div. Alternatively, use a `<button>` element.

### [ACCESSIBILITY] MAJOR ImageUploadField circle variant uses plain div for click interaction without keyboard support

File: src/components/forms/image-upload-field.tsx:75
Quote: ```tsx

  <div
    className="relative size-24 mx-auto cursor-pointer group"
    onClick={handleClick}
    onDragOver={handleDragOver}
  ```
  Rule:  WCAG 2.1 SC 2.1.1
  Fix:   Add `role="button"`, `tabIndex={0}`, and `onKeyDown` handler, or replace with a `<button>`.

### [ACCESSIBILITY] MAJOR Hidden file input has no accessible label or association

File: src/components/forms/image-upload-field.tsx:113
Quote: ```tsx
<input
ref={fileInputRef}
type="file"
accept={acceptedTypes.join(',')}
className="sr-only"
onChange={handleFileInputChange}
disabled={disabled || uploading}
/>

````
Rule:  WCAG 2.1 SC 1.3.1, SC 4.1.2
Fix:   Add `aria-label="Upload image"` or use `aria-labelledby` pointing to a visible label.

### [FILE-LENGTH] MINOR field.tsx exceeds 150-line limit (129 lines, close — but field.tsx is a custom component, not shadcn)
File: src/components/ui/field.tsx (129 lines)
Quote: ```
// 129 lines — within limit but borderline.
// Note: field.tsx is NOT a shadcn/vendored primitive — it is a custom wrapper.
````

Rule: CONTEXT.md §4 (max 150 lines per file, exempt: ui/ vendored shadcn)
Fix: No action needed now (129 < 150). Flag for awareness — file is custom, not exempt.

### [CONVENTION] MINOR form-error-banner.tsx uses `as { message: unknown }` cast instead of type guard

File: src/components/forms/form-error-banner.tsx:28
Quote: ```tsx
if (typeof error === 'object' && error !== null && 'message' in error) {
return String((error as { message: unknown }).message)
}

````
Rule:  Type safety best practice
Fix:   Extract a type guard function `hasMessage(e): e is { message: unknown }` or use a shared utility. Same pattern duplicated in `use-file-upload.ts:52-53`.

### [CONVENTION] MINOR Duplicate error extraction logic between form-error-banner.tsx and use-file-upload.ts
File: src/components/forms/image-upload-field/use-file-upload.ts:50-55
Quote: ```tsx
const message =
  (err instanceof Error ? err.message : '') ||
  (typeof err === 'object' && err !== null && 'message' in err
    ? String((err as { message: unknown }).message)
    : '') ||
  'Upload failed. Please try again.'
````

Rule: DRY
Fix: Extract a shared `extractErrorMessage(error: unknown): string` utility (the one in form-error-banner.tsx is already a good candidate) and reuse in both files.

### [CONVENTION] MINOR BaseFieldApi and BaseFieldApiTextarea types are nearly identical — should be unified

File: src/components/forms/form-text-field.tsx:8-20
Quote: ```tsx
export type BaseFieldApi = {
name: string
state: {
value: string
meta: {
isTouched: boolean
isValid: boolean
errors: Array<{ message?: string } | undefined>
}
}
handleBlur: () => void
handleChange: (value: string) => void
}

````
Rule:  DRY
Fix:   Extract to a shared type file (e.g., `src/components/forms/types.ts`) and import in both form-text-field.tsx and form-textarea.tsx.

### [NIT] NIT submit-button.tsx has import ordering issue — type import after value import
File: src/components/forms/submit-button.tsx:8-9
Quote: ```tsx
type AnyMutation = { isPending: boolean; error: unknown }
import type { ReactNode } from 'react'
````

Rule: Import ordering convention
Fix: Move `import type { ReactNode }` above the type definition, or group all imports together before any local type declarations.

### [NIT] NIT CopyButton silently swallows clipboard errors with empty catch

File: src/components/ui/copy-button.tsx:9-11
Quote: ```tsx
} catch {
// fallback
}

```
Rule:  Error handling best practice
Fix:   Either log the error or provide user feedback (e.g., toast) when clipboard write fails. At minimum, add a console.warn for debugging.

---

## Shadcn Primitives (auto-generated) — No Issues Flagged

All shadcn primitives in `src/components/ui/` (alert, alert-dialog, badge, button, card, chart, checkbox, collapsible, command, dialog, dropdown-menu, input, label, popover, select, separator, sheet, sidebar, skeleton, sonner, switch, table, tabs, textarea, tooltip) were scanned. No `any` usage or missing type exports found.

**Note:** `color-picker.tsx` (1623 lines) is a custom component, not a shadcn primitive. It is exempt from the 150-line rule only if classified as vendored/library code. If it is maintained in-tree, it significantly exceeds the limit. One `eslint-disable` comment was found at line 604 (`@typescript-eslint/no-empty-object-type`) which is acceptable for the extends-empty-interface pattern used.

**Note:** `sidebar.tsx` (724 lines) and `chart.tsx` (372 lines) are shadcn primitives and exempt from file-length checks.
```
