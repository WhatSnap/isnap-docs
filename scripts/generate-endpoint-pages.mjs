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

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')
const SPEC_PATH = resolve(REPO_ROOT, 'api-reference/openapi.json')
const OUT_ROOT = resolve(REPO_ROOT, 'api-reference')
const DOCS_PATH = resolve(REPO_ROOT, 'docs.json')

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

// Per-resource sidebar order. Slugs in this list are placed first, in
// the listed order; anything else falls in alphabetically after. Lets
// us put the "send" before "list" before "cancel" instead of relying
// on alphabetical sort.
const PAGE_ORDER = {
  Messages: [
    'post-messages',
    'get-messages',
    'get-messages-id',
    'post-messages-id-reactions',
    'delete-messages-id-reactions',
    'delete-messages-id'
  ],
  Webhooks: [
    'get-webhooks-events',
    'post-webhooks',
    'get-webhooks',
    'get-webhooks-id',
    'patch-webhooks-id',
    'delete-webhooks-id',
    'post-webhooks-id-rotate-secret',
    'get-webhooks-id-deliveries',
    'post-webhooks-id-deliveries-delivery_id-replay'
  ],
  Lines: [
    // Marketplace + your fleet
    'get-lines',
    'get-lines-my',
    'get-lines-id',
    'patch-lines-id',
    // Lifecycle
    'post-lines-assign',
    'post-lines-id-reserve',
    'post-lines-id-activate',
    'post-lines-id-release',
    'post-lines-id-transfer-ownership',
    // Operational surface
    'get-lines-id-config',
    'patch-lines-id-config',
    'get-lines-id-quota',
    'get-lines-id-queue',
    'get-lines-id-health'
  ],
  Trial: [
    'post-trial-init',
    'get-trial-status',
    'get-trial-activity'
  ],
  Billing: [
    'post-billing-checkout',
    'post-billing-byod-checkout',
    'get-billing-subscriptions',
    'delete-billing-subscriptions-id',
    'get-billing-invoices',
    'get-billing-payment-methods',
    'post-billing-payment-methods',
    'post-billing-payment-methods-id-default',
    'delete-billing-payment-methods-id'
  ],
  Attachments: [
    'post-attachments',
    'get-attachments-id'
  ],
  Chats: [
    'post-chats-chat_id-typing',
    'delete-chats-chat_id-typing',
    'post-chats-chat_id-read',
    'post-chats-chat_id-share-contact-card'
  ],
  'API Keys': [
    'post-api-keys',
    'get-api-keys',
    'delete-api-keys-id'
  ],
  'Pre-orders': [
    'post-pre-orders',
    'get-pre-orders',
    'get-pre-orders-id',
    'post-pre-orders-id-cancel'
  ],
  Meta: [
    'get-health',
    'get-version'
  ]
}

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

const groupedPages = new Map() // group label → ordered array of nav paths

let filesCreated = 0
let filesPreserved = 0
for (const [path, ops] of Object.entries(spec.paths ?? {})) {
  for (const method of METHODS) {
    const op = ops[method]
    if (!op) continue

    const { label, dir } = classify(path)
    const slug = slugFromOperation(method, path, op)
    const title = titleFromOperation(method, path, op)

    const fileDir = resolve(OUT_ROOT, dir)
    mkdirSync(fileDir, { recursive: true })

    const filePath = resolve(fileDir, `${slug}.mdx`)
    if (existsSync(filePath)) {
      // Preserve any prose enrichments already added to this file.
      // Frontmatter mismatches are surfaced as a manual TODO in
      // PHASE4-ISSUES.md rather than auto-overwritten.
      filesPreserved += 1
    } else {
      const body = `---
title: "${escapeMdxString(title)}"
openapi: "${method.toUpperCase()} ${path}"
---
`
      writeFileSync(filePath, body)
      filesCreated += 1
    }

    if (!groupedPages.has(label)) groupedPages.set(label, [])
    groupedPages.get(label).push(`api-reference/${dir}/${slug}`)
  }
}

// Build the navigation Endpoints groups in the canonical order.
const endpointsGroups = []
for (const groupLabel of GROUP_ORDER) {
  const pages = groupedPages.get(groupLabel)
  if (!pages || pages.length === 0) continue

  const manual = PAGE_ORDER[groupLabel] ?? []
  // Page IDs include the resource directory (e.g. `api-reference/messages/post-messages`);
  // PAGE_ORDER lists the bare slug. Match on the trailing slug.
  const slugOf = (id) => id.split('/').pop()
  const manualSet = new Set(manual)
  const head = manual
    .map((slug) => pages.find((p) => slugOf(p) === slug))
    .filter(Boolean)
  const tail = pages.filter((p) => !manualSet.has(slugOf(p))).sort()
  endpointsGroups.push({ group: groupLabel, pages: [...head, ...tail] })
}

// Splice into docs.json's API Reference tab — replace the per-resource
// endpoint groups, leaving the leading "API Reference" intro group and
// every other tab (Guides, SDK, Changelog) untouched.
const docs = JSON.parse(readFileSync(DOCS_PATH, 'utf8'))
const ENDPOINT_GROUP_LABELS = new Set([...GROUP_ORDER])

const apiTab = docs.navigation?.tabs?.find((t) => t.tab === 'API Reference')
if (!apiTab) {
  throw new Error('docs.json navigation has no "API Reference" tab; refusing to splice.')
}

const introGroup = apiTab.groups.find((g) => g.group === 'API Reference')
if (!introGroup) {
  throw new Error('docs.json API Reference tab is missing the intro group; refusing to splice.')
}

apiTab.groups = [introGroup, ...endpointsGroups]
writeFileSync(DOCS_PATH, JSON.stringify(docs, null, 2) + '\n')

console.log(
  `generate-endpoint-pages: ${filesCreated} created, ${filesPreserved} preserved`
)
console.log(`  groups: ${endpointsGroups.map((g) => `${g.group} (${g.pages.length})`).join(', ')}`)
