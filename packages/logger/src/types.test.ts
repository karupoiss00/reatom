import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, test } from 'vitest'

test('built declarations work without Node.js types', () => {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
    types: [],
    strict: true,
    skipLibCheck: false,
    noEmit: true,
  }
  const host = ts.createCompilerHost(options)
  // Simulate a consumer without the workspace's installed @types packages.
  host.resolveTypeReferenceDirectives = (directives) =>
    directives.map(() => undefined)

  const program = ts.createProgram(
    [fileURLToPath(new URL('../build/index.d.ts', import.meta.url))],
    options,
    host,
  )

  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    )

  expect(diagnostics).toEqual([])
})
