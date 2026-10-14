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

## MCP

From the signed-in header, open **Settings → MCP** and paste any Streamable HTTP URL. The app is generic MCP: there is no built-in Fusion product. The composer chip takes the server name, or **MCP**.

`localhost` is rewritten to `127.0.0.1`. Chrome Console, not the red Network row, tells refused (`net::ERR_CONNECTION_REFUSED`, nothing listening) vs CORS (`blocked by CORS policy`). If CORS: the MCP server must allow origin `http://127.0.0.1:5180`, POST and OPTIONS, and headers `Content-Type`, `Accept`, and `Mcp-Protocol-Version`. Reconnect after. Browser clients need those headers even when the server's docs omit CORS.

Worked example — Autodesk Fusion. Open a design, enable **Fusion MCP Server** (**Preferences → General → API**), copy `http://127.0.0.1:27182/mcp`, **Connect**, then turn on the server chip in the composer. Writes wait for **Allow once**. Refused usually means Fusion is off. Fusion Preferences have no origin allowlist — if Fusion does not send CORS, Connect cannot succeed from this tab until the server does.
