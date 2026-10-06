# Atelier

A browser-only chat shell on [`@reatom/jsx`](../../packages/jsx), [`@reatom/core`](../../packages/core), and `@openrouter/sdk@1.4.22`. This directory is the scaffold: layout, design tokens, the OpenRouter client factory, and the browser test harness. Chat flows come later.

## Run

```sh
pnpm install
pnpm exec vite --host 127.0.0.1 --port 5180 --strictPort
```

Open http://127.0.0.1:5180/. The dev server is strict about that port. Theme follows `prefers-color-scheme`.

## Test

```sh
pnpm exec tsc --noEmit --pretty false
pnpm run build
pnpm exec vitest run
```

Vitest runs in headless Chromium through `@vitest/browser-playwright`. If the browser binary is missing:

```sh
pnpm exec playwright install chromium
```

`src/testing/openrouter-mock.ts` intercepts `fetch` to `https://openrouter.ai/api/v1/**`. Fixtures in `src/testing/fixtures/` are snake_case wire JSON. The mock tests call the real SDK against that intercept, including streamed chat, `/key`, `/models`, `/generation`, and `AbortSignal`.

Screenshots from `shot(flowId, name)` are written to `.team/evidence/<flowId>/<name>.png`. The shell test records light and dark frames at `.team/evidence/T-000/`.
