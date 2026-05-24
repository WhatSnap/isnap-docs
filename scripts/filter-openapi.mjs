#!/usr/bin/env bun
// Filters the iSnap-App OpenAPI spec down to the partner-facing surface.
//
// Source by default: the R2-published spec at
// `https://spec.isnap.ai/<env>/openapi.json`, where <env> is
// `staging` today and flips to `prod` at GA. Each iSnap_DeployStaging
// (resp. DeployProduction) TC build curls /openapi.json off the
// running backend and uploads it here — so this always reflects what
// the currently-deployed environment actually serves. No reliance on
// a committed `packages/backend/openapi.json` artifact (which has
// drifted in the past).
//
// Switching the default at launch:
//   - Set `ISNAP_DOCS_SPEC_ENV=prod` in the build env, OR
//   - Flip DEFAULT_ENV below to 'prod' and commit.
// `spec.isnap.ai/prod/openapi.json` only exists after the first
// iSnap_DeployProduction publish; until then, leave on 'staging'.
//
// Overrides:
//   bun scripts/filter-openapi.mjs <path>     # read from a local file
//   ISNAP_DOCS_SPEC_URL=https://...           # explicit URL
//   ISNAP_DOCS_SPEC_ENV=prod|staging          # pick the R2 env
//
// Fallback: if R2 is unreachable, falls back to
// `git show origin/staging:packages/backend/openapi.json` for offline
// preview. The fallback can be stale — only use for local previews.
//
// Writes: api-reference/openapi.json
//
// The upstream spec includes internal dashboard / ops / device-app / migration
// routes that are NOT part of the partner contract. Mintlify renders every
// path it finds, so we strip everything that isn't `/v1/*`. The Stripe webhook
// (`/billing/webhooks/stripe`) is also dropped because the consumer is Stripe,
// not a partner.

import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')
const ISNAP_APP_ROOT = resolve(REPO_ROOT, '../iSnap-App')

const DEFAULT_ENV = 'staging' // flip to 'prod' at GA — see header comment

const outputPath = resolve(REPO_ROOT, 'api-reference/openapi.json')

let specJson
let sourceLabel
if (process.argv[2]) {
  const inputPath = resolve(process.argv[2])
  specJson = readFileSync(inputPath, 'utf8')
  sourceLabel = inputPath
} else {
  const env = process.env.ISNAP_DOCS_SPEC_ENV ?? DEFAULT_ENV
  const url = process.env.ISNAP_DOCS_SPEC_URL ?? `https://spec.isnap.ai/${env}/openapi.json`
  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`)
    }
    specJson = await response.text()
    sourceLabel = url
  } catch (err) {
    console.warn(`⚠️  R2 fetch failed (${err.message}), falling back to git show origin/staging`)
    specJson = execSync('git show origin/staging:packages/backend/openapi.json', {
      cwd: ISNAP_APP_ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    })
    sourceLabel = 'origin/staging (iSnap-App) — fallback'
  }
}

const spec = JSON.parse(specJson)

// Some `/v1/*` paths are legacy device callbacks that pre-date the
// current device contract. They're still served for the bridge app but
// aren't part of the customer-facing API surface — drop them too.
const LEGACY_DEVICE_CALLBACKS = new Set([
  '/v1/messages/inbound',
  '/v1/messages/{id}/status'
])

const before = Object.keys(spec.paths ?? {}).length
const kept = {}
const dropped = []
for (const [path, ops] of Object.entries(spec.paths ?? {})) {
  if (path.startsWith('/v1/') && !LEGACY_DEVICE_CALLBACKS.has(path)) {
    kept[path] = ops
  } else {
    dropped.push(path)
  }
}

spec.paths = kept

// Pin the production server. Internal environments are not surfaced to
// customers — partners only ever talk to api.isnap.ai.
spec.servers = [{ url: 'https://api.isnap.ai' }]

// Declare bearerAuth as the global default security requirement.
// Mintlify renders the Authorization param panel on every endpoint
// from the root-level `security` field. Per-operation security on
// individual routes overrides this (e.g. /v1/health and /v1/version
// already carry an empty `security: []` override from upstream to
// mark themselves unauthed — keep that). Otherwise every authed
// endpoint inherits this default.
spec.security = [{ bearerAuth: [] }]

// Mintlify does NOT render multi-status response codes on a single
// endpoint page — confirmed via their llms-full.txt: the "Multiple
// responses" feature is for variations within a SINGLE 2xx status
// code via `examples`, not for different status codes. Any 4xx / 5xx
// we add to the spec gets silently dropped at render time.
//
// Errors are documented via a "## Errors" section in the prose body
// of each endpoint .mdx page (status / code / cause table + worked
// example) and via the global accordion in api-reference/introduction.mdx.

writeFileSync(outputPath, JSON.stringify(spec, null, 2) + '\n')

console.log(`filter-openapi: ${before} paths → ${Object.keys(kept).length} kept`)
console.log(`  source: ${sourceLabel}`)
console.log(`  output: ${outputPath}`)
if (dropped.length) {
  console.log(`  dropped (${dropped.length}):`)
  for (const p of dropped) console.log(`    - ${p}`)
}
