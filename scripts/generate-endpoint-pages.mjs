#!/usr/bin/env bun
// Generates one .mdx file per /v1/* operation in the filtered OpenAPI
// spec, with frontmatter Mintlify uses to render the operation:
//
//   ---
//   title: "Send a message"
//   openapi: "POST /v1/messages"
//   ---
//
// Files land under api-reference/<resource>/<slug>.mdx. The same script
// also rewrites the Endpoints group inside mint.json so navigation
// stays in sync with the generated tree.
//
// Run:  bun run scripts/generate-endpoint-pages.mjs

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')
const SPEC_PATH = resolve(REPO_ROOT, 'api-reference/openapi.json')
const OUT_ROOT = resolve(REPO_ROOT, 'api-reference')
const MINT_PATH = resolve(REPO_ROOT, 'mint.json')

const METHODS = ['get', 'post', 'put', 'patch', 'delete']

// Maps the second `/v1/<resource>` path segment to a UI group label and
// directory slug. Anything not in this map gets filed under "Meta".
const RESOURCE_GROUPS = {
  'api-keys': { label: 'API Keys', dir: 'api-keys' },
  attachments: { label: 'Attachments', dir: 'attachments' },
  billing: { label: 'Billing', dir: 'billing' },
  byod: { label: 'BYOD', dir: 'byod' },
  chats: { label: 'Chats', dir: 'chats' },
  lines: { label: 'Lines', dir: 'lines' },
  lookup: { label: 'Lookup', dir: 'lookup' },
  messages: { label: 'Messages', dir: 'messages' },
  'pre-orders': { label: 'Pre-orders', dir: 'pre-orders' },
  trial: { label: 'Trial', dir: 'trial' },
  webhooks: { label: 'Webhooks', dir: 'webhooks' }
}

// Group order for the sidebar — most-used first.
const GROUP_ORDER = [
  'Messages',
  'Lines',
  'Webhooks',
  'Lookup',
  'Trial',
  'BYOD',
  'Billing',
  'Attachments',
  'Chats',
  'API Keys',
  'Pre-orders',
  'Meta'
]

function classify(path) {
  // path: '/v1/messages/{id}'  →  resource segment: 'messages'
  const segs = path.replace(/^\/v1\//, '').split('/')
  const resource = segs[0]
  const group = RESOURCE_GROUPS[resource]
  return group ?? { label: 'Meta', dir: 'meta' }
}

function slugFromOperation(method, path, op) {
  // Prefer the openapi operationId — already kebab-case-friendly.
  if (op.operationId) {
    return op.operationId
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/_/g, '-')
      .toLowerCase()
  }
  // Fallback: derive from `<method>-<full-path-tail>`. Including the
  // resource segment makes slugs unique even for collection-root paths
  // like `/v1/version` and `/v1/health` (otherwise both → `get`).
  const tail = path
    .replace(/^\/v1\//, '')
    .replace(/\{([^}]+)\}/g, '$1')
    .replace(/[/{}]/g, '-')
    .replace(/^-|-$/g, '')
  return `${method}-${tail}`
}

function titleFromOperation(method, path, op) {
  if (op.summary) return op.summary
  // Default: `METHOD /path` — readable enough for a heading.
  return `${method.toUpperCase()} ${path}`
}

function escapeMdxString(s) {
  return s.replace(/"/g, '\\"')
}

const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8'))

// Wipe and recreate generated dirs so removing endpoints upstream
// doesn't leave orphaned files.
for (const { dir } of Object.values(RESOURCE_GROUPS)) {
  rmSync(resolve(OUT_ROOT, dir), { recursive: true, force: true })
}
rmSync(resolve(OUT_ROOT, 'meta'), { recursive: true, force: true })

const groupedPages = new Map() // group label → ordered array of nav paths

let filesWritten = 0
for (const [path, ops] of Object.entries(spec.paths ?? {})) {
  for (const method of METHODS) {
    const op = ops[method]
    if (!op) continue

    const { label, dir } = classify(path)
    const slug = slugFromOperation(method, path, op)
    const title = titleFromOperation(method, path, op)

    const fileDir = resolve(OUT_ROOT, dir)
    mkdirSync(fileDir, { recursive: true })

    const body = `---
title: "${escapeMdxString(title)}"
openapi: "${method.toUpperCase()} ${path}"
---
`
    writeFileSync(resolve(fileDir, `${slug}.mdx`), body)
    filesWritten += 1

    if (!groupedPages.has(label)) groupedPages.set(label, [])
    groupedPages.get(label).push(`api-reference/${dir}/${slug}`)
  }
}

// Build the navigation Endpoints groups in the canonical order.
const endpointsGroups = []
for (const groupLabel of GROUP_ORDER) {
  const pages = groupedPages.get(groupLabel)
  if (!pages || pages.length === 0) continue
  pages.sort()
  endpointsGroups.push({ group: groupLabel, pages })
}

// Splice into mint.json — replace the existing Endpoints groups with
// the regenerated ones, leaving everything else (Get started, Guides,
// Concepts, SDK, Changelog) untouched.
const mint = JSON.parse(readFileSync(MINT_PATH, 'utf8'))
const ENDPOINT_GROUP_LABELS = new Set([...GROUP_ORDER])
const otherGroups = mint.navigation.filter((g) => !ENDPOINT_GROUP_LABELS.has(g.group))

// Find the API Reference group; insert the endpoint groups right after it.
const apiRefIndex = otherGroups.findIndex((g) => g.group === 'API Reference')
if (apiRefIndex < 0) {
  throw new Error('mint.json navigation has no "API Reference" group; refusing to splice.')
}

const newNav = [
  ...otherGroups.slice(0, apiRefIndex + 1),
  ...endpointsGroups,
  ...otherGroups.slice(apiRefIndex + 1)
]
mint.navigation = newNav
writeFileSync(MINT_PATH, JSON.stringify(mint, null, 2) + '\n')

console.log(`generate-endpoint-pages: wrote ${filesWritten} files`)
console.log(`  groups: ${endpointsGroups.map((g) => `${g.group} (${g.pages.length})`).join(', ')}`)
