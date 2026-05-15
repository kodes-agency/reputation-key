```markdown
# reputation-key Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill covers the core development patterns and workflows used in the `reputation-key` TypeScript codebase. It documents coding conventions, file organization, and automated workflows—especially around file renaming and import management. The goal is to help contributors maintain consistency, reduce errors, and streamline collaboration.

## Coding Conventions

### File Naming
- **Style:** kebab-case (all lowercase, words separated by hyphens)
- **Example:**  
  `link-tree-category-list.tsx`  
  `use-link-tree-reorder.ts`

### Import Style
- **Style:** Absolute imports from the project root.
- **Example:**
  ```typescript
  import { LinkTreeCategoryList } from 'src/components/features/portal/link-tree/link-tree-category-list';
  ```

### Export Style
- **Style:** Named exports (no default exports).
- **Example:**
  ```typescript
  // In link-tree-category-list.tsx
  export const LinkTreeCategoryList = () => { /* ... */ };
  ```

### Commit Messages
- **Convention:** Conventional commits
- **Prefixes:** `fix`, `refactor`
- **Example:**  
  `fix: correct import path after file rename`  
  `refactor: update link-tree state management logic`

## Workflows

### File Rename and Import Update
**Trigger:** When you need to rename a file to follow naming conventions (e.g., kebab-case) and ensure all imports are updated accordingly.  
**Command:** `/rename-file-and-update-imports`

1. **Rename the target file** to match the kebab-case convention.
2. **Search for all imports** of the old file name across the codebase.
3. **Update each import statement** to use the new file name.
4. **Test affected features** to ensure no import errors.

**Example:**
Suppose you want to rename `LinkTreeCategoryList.tsx` to `link-tree-category-list.tsx`:

- Rename the file:
  ```
  mv src/components/features/portal/link-tree/LinkTreeCategoryList.tsx src/components/features/portal/link-tree/link-tree-category-list.tsx
  ```
- Update all imports:
  ```typescript
  // Before
  import { LinkTreeCategoryList } from 'src/components/features/portal/link-tree/LinkTreeCategoryList';
  // After
  import { LinkTreeCategoryList } from 'src/components/features/portal/link-tree/link-tree-category-list';
  ```
- Run tests or start the app to verify there are no import errors.

## Testing Patterns

- **Test File Pattern:** `*.test.*`
- **Framework:** Unknown (check for files like `link-tree-category-list.test.tsx`)
- **Typical Usage:** Place tests alongside source files or in a dedicated test directory, using the `.test.ts` or `.test.tsx` suffix.

**Example:**
```typescript
// link-tree-category-list.test.tsx
import { LinkTreeCategoryList } from './link-tree-category-list';

describe('LinkTreeCategoryList', () => {
  it('renders correctly', () => {
    // test implementation
  });
});
```

## Commands

| Command                         | Purpose                                                           |
|----------------------------------|-------------------------------------------------------------------|
| /rename-file-and-update-imports  | Standardizes file naming and updates all relevant import paths.    |
```
