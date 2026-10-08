// Preloaded with `node --import` by `npm test`. Registers the module-resolution
// hook in alias-loader.mjs before any test file is imported.
import { register } from 'node:module'

register('./alias-loader.mjs', import.meta.url)
