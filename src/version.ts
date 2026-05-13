import pkg from '../package.json' with { type: 'json' }

/**
 * Action version. Read directly from package.json so there is no
 * second-source-of-truth to keep in sync — bumping `version` in package.json
 * automatically propagates here, into the User-Agent header, and into the
 * bundled `dist/index.js`.
 *
 * Works because:
 *   - Node 22+ supports native JSON import attributes.
 *   - ncc / webpack statically inlines the JSON at bundle time, so the
 *     runtime artifact has the version baked in as a string literal.
 *   - TypeScript's `resolveJsonModule` makes the import type-safe.
 */
export const VERSION: string = pkg.version
