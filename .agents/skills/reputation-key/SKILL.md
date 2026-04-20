```markdown
# reputation-key Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches you the core development patterns and conventions used in the `reputation-key` TypeScript codebase, which is built on the Vite framework. You'll learn about file naming, import/export styles, commit message conventions, and how to structure and run tests. This guide is ideal for onboarding new contributors or maintaining consistency across the project.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `reputationKey.ts`, `userProfileManager.ts`

### Import Style
- Mixed import styles are used. Both default and named imports may appear.
  - Example:
    ```typescript
    import myFunction from './myFunction'
    import { helperA, helperB } from './helpers'
    ```

### Export Style
- Both default and named exports are present.
  - Example:
    ```typescript
    // Default export
    export default function reputationKey() { ... }

    // Named export
    export function calculateScore() { ... }
    ```

### Commit Message Conventions
- Use **Conventional Commits** with the `chore` prefix.
- Messages are concise (average ~50 characters).
  - Example:
    ```
    chore: update dependencies to latest versions
    ```

## Workflows

### Code Commit Workflow
**Trigger:** When making any code change  
**Command:** `/commit`

1. Make your code changes following the coding conventions.
2. Stage your changes:
    ```
    git add .
    ```
3. Write a conventional commit message with the `chore` prefix:
    ```
    git commit -m "chore: describe your change here"
    ```
4. Push your changes:
    ```
    git push
    ```

### File Naming Workflow
**Trigger:** When creating new files  
**Command:** `/create-file`

1. Name your file using camelCase.
2. Place the file in the appropriate directory.
3. Use the correct import/export style as per the conventions.

## Testing Patterns

- Test files use the pattern: `*.test.*` (e.g., `userProfile.test.ts`)
- The specific test framework is unknown, but tests should be colocated with the code or in a `tests` directory.
- Example test file:
    ```typescript
    // userProfile.test.ts
    import { getUserProfile } from './userProfile'

    describe('getUserProfile', () => {
      it('returns correct profile data', () => {
        // test implementation
      })
    })
    ```

## Commands
| Command      | Purpose                                      |
|--------------|----------------------------------------------|
| /commit      | Guide for making a conventional commit       |
| /create-file | Steps for creating a new code file properly  |
```
