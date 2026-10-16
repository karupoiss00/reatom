declare module 'chat-app/App' {
  export const App: () => JSX.Element
}

declare module 'chat-app/app/boot' {
  export function boot(options?: {
    timings?: Record<string, number>
  }): Promise<unknown>
}

declare module 'chat-app/auth/keyStore' {
  export function writeStoredKey(key: string, remember: boolean): boolean
  export function placeKey(key: string, remember: boolean): boolean
}

declare module 'chat-app/testing/env' {
  export function resetBrowserState(): Promise<void>
}

declare module 'chat-app/testing/openrouter-mock' {
  export function installOpenRouterMock(): void
  export function uninstallOpenRouterMock(): void
  export function resetOpenRouterMock(): void
  export function mockKey(meta: object): void
  export function mockModels(list: readonly object[]): void
  export function mockChatStream(script: object): void
  export function mockChatStreams(scripts: readonly object[]): void
  export function mockChatStreamFor(model: string, script: object): void
}

declare module 'chat-app/testing/fixtures/keys' {
  export const limitedKey: object
}

declare module 'chat-app/testing/fixtures/models' {
  export const catalogModels: readonly object[]
}
