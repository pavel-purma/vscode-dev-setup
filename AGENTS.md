# Coding Standards for AI Agents

## Overview

- TypeScript 6+ with strict mode enabled
- VS Code Extension targeting ES2022
- Node.js platform with zero runtime dependencies (only devDependencies)

## Async Patterns

- Use `async/await` exclusively — no `.then()` chains or callbacks
- All async functions must have explicit return types (`Promise<T>`)

## Naming Conventions

- Files: `camelCase.ts` (e.g., `configFinder.ts`)
- Interfaces/Types: `PascalCase` (e.g., `DevSetupConfig`)
- Functions: `camelCase` (e.g., `fetchSecretsFromConfig`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `DOPPLER_API_BASE`)

## Code Style

- Named exports only — no default exports
- Explicit return types on all public functions
- JSDoc `/** */` comments on all public functions
- Single quotes for strings, backticks for template literals
- Semicolons always
- Trailing commas in multi-line constructs

## Error Handling

- Use `try/catch` with granular error handling at each level
- Narrow error types: `err instanceof Error ? err.message : String(err)`
- Distinguish expected vs unexpected errors (re-throw unexpected ones)
- User-facing errors via `vscode.window.showErrorMessage()` with `Dev Setup:` prefix

## Module Organization

- Export only the public API; keep helpers unexported
- Each VS Code command gets its own `register*Command()` function
- All disposables registered via `context.subscriptions.push()`

## Best Practices

- Use VS Code's `SecretStorage` API for secrets — never persist in plaintext
- Validate data structures before casting (validation-first parsing)
- Sort output deterministically where applicable
- Support multi-root workspaces
