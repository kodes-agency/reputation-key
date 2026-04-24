```markdown
# reputation-key Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `reputation-key` repository, a TypeScript React codebase. You will learn about file naming, import/export styles, commit message patterns, and testing practices. This guide enables consistent, high-quality contributions and efficient collaboration.

## Coding Conventions

### File Naming
- Use **camelCase** for all file names.
  - Example: `userProfile.ts`, `reputationKeyManager.tsx`

### Import Style
- Use **absolute imports** for modules.
  - Example:
    ```typescript
    import { ReputationService } from 'services/reputationService';
    ```

### Export Style
- Use **named exports** for all modules.
  - Example:
    ```typescript
    // In reputationKeyManager.ts
    export function generateKey() { ... }
    export function validateKey() { ... }
    ```

### Commit Message Pattern
- Use **conventional commits** with the `feat` prefix for new features.
  - Example:
    ```
    feat: add reputation key validation logic
    ```

## Workflows

_No automated workflows detected in this repository._

## Testing Patterns

- **Testing Framework:** [Vitest](https://vitest.dev/)
- **Test File Pattern:** Name test files with `.test.ts` suffix.
  - Example: `reputationKeyManager.test.ts`
- **Test Example:**
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { generateKey } from 'services/reputationKeyManager';

  describe('generateKey', () => {
    it('should generate a valid key', () => {
      const key = generateKey();
      expect(key).toMatch(/[A-Z0-9]{10}/);
    });
  });
  ```

## Commands
| Command | Purpose |
|---------|---------|
| /test   | Run all tests using Vitest |
| /lint   | Run linter to check code style |
| /build  | Build the project for production |
```
