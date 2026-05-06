#!/usr/bin/env bun
// Filters the iSnap-App OpenAPI spec down to the partner-facing surface.
//
// Reads:  ../iSnap-App/packages/backend/openapi.json  (or first argv path)
// Writes: api-reference/openapi.json
//
// The upstream spec includes internal dashboard / ops / device-app / migration
// routes that are NOT part of the partner contract. Mintlify renders every
// path it finds, so we strip everything that isn't `/v1/*`. The Stripe webhook
// (`/billing/webhooks/stripe`) is also dropped because the consumer is Stripe,
// not a partner.
//
// Run after every backend OpenAPI change:
//   bun run scripts/filter-openapi.mjs
//
// Once `spec.isnap.ai/openapi.json` is live (WHA-704) and the publication
// pipeline filters server-side, this script and the vendored copy go away.

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')

const DEFAULT_INPUT = resolve(REPO_ROOT, '../iSnap-App/packages/backend/openapi.json')
const inputPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_INPUT
const outputPath = resolve(REPO_ROOT, 'api-reference/openapi.json')

const spec = JSON.parse(readFileSync(inputPath, 'utf8'))

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

writeFileSync(outputPath, JSON.stringify(spec, null, 2) + '\n')

console.log(`filter-openapi: ${before} paths → ${Object.keys(kept).length} kept`)
console.log(`  input:  ${inputPath}`)
console.log(`  output: ${outputPath}`)
if (dropped.length) {
  console.log(`  dropped (${dropped.length}):`)
  for (const p of dropped) console.log(`    - ${p}`)
}
