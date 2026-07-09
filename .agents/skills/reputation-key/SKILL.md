```markdown
# reputation-key Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill documents the core development patterns and conventions used in the `reputation-key` repository, a TypeScript React codebase. It covers file naming, import/export styles, commit message conventions, and testing patterns, providing examples and suggested commands for efficient collaboration.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `userProfile.tsx`, `reputationKey.ts`

### Import Style
- Use **absolute imports** for modules.
  - Example:
    ```typescript
    import { UserProfile } from 'components/userProfile';
    ```

### Export Style
- Use **named exports** exclusively.
  - Example:
    ```typescript
    // userProfile.tsx
    export const UserProfile = () => { /* ... */ };
    ```

### Commit Message Convention
- Use **conventional commits** with the `chore` prefix.
  - Example:
    ```
    chore: update dependencies for security patch
    ```

## Workflows

### Commit Changes
**Trigger:** When making any code changes  
**Command:** `/commit-changes`

1. Stage your changes with `git add`.
2. Write a commit message using the conventional format, starting with `chore:`.
   - Example: `chore: refactor reputation calculation logic`
3. Commit your changes with `git commit`.
4. Push to the repository with `git push`.

### Add a New Component
**Trigger:** When adding a new React component  
**Command:** `/add-component`

1. Create a new file in the appropriate directory using camelCase (e.g., `newComponent.tsx`).
2. Implement the component using named exports.
   - Example:
     ```typescript
     export const NewComponent = () => { /* ... */ };
     ```
3. Import the component using an absolute path where needed.
   - Example:
     ```typescript
     import { NewComponent } from 'components/newComponent';
     ```
4. Write tests in a file named `newComponent.test.tsx`.

### Write and Run Tests
**Trigger:** When verifying code functionality  
**Command:** `/run-tests`

1. Create or update test files using the pattern `*.test.*` (e.g., `userProfile.test.tsx`).
2. Use the project's test runner to execute tests (framework unknown; refer to project scripts).
3. Review test results and fix any failures.

## Testing Patterns

- Test files use the pattern `*.test.*` (e.g., `reputationKey.test.ts`).
- Place test files alongside the code they test or in a dedicated test directory.
- Use the project's preferred (unspecified) testing framework.
- Example test file:
  ```typescript
  // reputationKey.test.ts
  import { calculateReputation } from 'utils/reputationKey';

  describe('calculateReputation', () => {
    it('returns correct score', () => {
      expect(calculateReputation(10)).toBe(100);
    });
  });
  ```

## Commands
| Command         | Purpose                                   |
|-----------------|-------------------------------------------|
| /commit-changes | Guide for committing code changes         |
| /add-component  | Steps to add a new React component        |
| /run-tests      | Instructions for writing and running tests|
```