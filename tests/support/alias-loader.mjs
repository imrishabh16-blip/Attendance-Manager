// Node resolution hook for the test runner (Node runs .ts files natively, but
// knows nothing about tsconfig's "@/*" -> "src/*" path alias).
//
//  - "@/foo/bar" resolves to src/foo/bar.ts (or .tsx / index.ts).
//  - "@/lib/supabase/server" is swapped for a stub, because the real module
//    needs Next's request-scoped cookies(). Type-checking still sees the real
//    module through tsconfig paths; only the runtime import is replaced.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const STUBS = {
  '@/lib/supabase/server': path.join(root, 'tests', 'support', 'supabaseServerStub.ts'),
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const stub = STUBS[specifier]
    if (stub) return { url: pathToFileURL(stub).href, shortCircuit: true }

    const base = path.join(root, 'src', specifier.slice(2))
    for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
      if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true }
    }
  }
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    // Next ships CJS entry points like "next/server" with no "exports" map,
    // which bundlers resolve but Node's ESM resolver does not ("next/server.js").
    if (err?.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('next/') && !specifier.endsWith('.js')) {
      return nextResolve(`${specifier}.js`, context)
    }
    throw err
  }
}
