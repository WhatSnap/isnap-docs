#!/usr/bin/env node
// Keeps the API reference pages in step with api-reference/openapi.json. Run it after every import:
//
//   node scripts/generate-reference-pages.mjs          create missing pages, fix titles, write the nav
//   node scripts/generate-reference-pages.mjs --check  change nothing; exit 1 when something is stale
//
// For each operation of the spec there is one page, api-reference/<dir>/<slug>.mdx, named by the
// OPERATIONS table below. The script owns three things and nothing else:
//   - the `title` of the page, which is the operation's `summary`;
//   - the `openapi` line of the page, which binds it to the operation;
//   - the groups of the "API reference" tab in docs.json, after its first group (the overview).
// The `description` and the body of a page are written by hand and are never touched.
// An operation that is not in the table, a table entry whose operation left the spec, and a page that
// no entry names are errors: decide the slug or delete the page.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SPEC_PATH = 'api-reference/openapi.json'
const REFERENCE_DIR = 'api-reference'
const DOCS_JSON = 'docs.json'
const TAB = 'API reference'
const OVERVIEW_PAGE = 'api-reference/introduction'

// Group, in sidebar order, then its operations, in sidebar order: [operation, directory, slug].
const OPERATIONS = [
  ['Messages', [
    ['POST /v1/messages', 'messages', 'send-message'],
    ['GET /v1/messages', 'messages', 'list-messages'],
    ['GET /v1/messages/{id}', 'messages', 'get-message'],
    ['DELETE /v1/messages/{id}', 'messages', 'cancel-message'],
    ['POST /v1/messages/{id}/reactions', 'messages', 'add-reaction'],
    ['DELETE /v1/messages/{id}/reactions', 'messages', 'remove-reaction']
  ]],
  ['Chats', [
    ['GET /v1/chats', 'chats', 'list-chats'],
    ['GET /v1/chats/{chat_id}', 'chats', 'get-chat'],
    ['POST /v1/chats/{chat_id}/read', 'chats', 'mark-chat-read'],
    ['POST /v1/chats/{chat_id}/typing', 'chats', 'start-typing'],
    ['DELETE /v1/chats/{chat_id}/typing', 'chats', 'stop-typing'],
    ['POST /v1/chats/{chat_id}/share-contact-card', 'chats', 'share-contact-card']
  ]],
  ['Attachments', [
    ['POST /v1/attachments', 'attachments', 'create-attachment'],
    ['GET /v1/attachments/{id}', 'attachments', 'get-attachment']
  ]],
  ['Recipient lookup', [
    ['POST /v1/lookup', 'lookup', 'look-up-recipient']
  ]],
  ['Lines', [
    ['GET /v1/lines', 'lines', 'list-available-lines'],
    ['GET /v1/lines/{id}', 'lines', 'get-line'],
    ['GET /v1/lines/my', 'lines', 'list-my-lines'],
    ['PATCH /v1/lines/{id}', 'lines', 'update-line'],
    ['POST /v1/lines/{id}/reserve', 'lines', 'reserve-line'],
    ['POST /v1/lines/{id}/activate', 'lines', 'activate-line'],
    ['POST /v1/lines/{id}/release', 'lines', 'release-line'],
    ['POST /v1/lines/assign', 'lines', 'assign-line'],
    ['POST /v1/lines/shared', 'lines', 'create-shared-line']
  ]],
  ['Line lifecycle', [
    ['POST /v1/lines/{id}/terminate', 'lines', 'terminate-line'],
    ['POST /v1/lines/{id}/cancel', 'lines', 'cancel-line'],
    ['POST /v1/lines/{id}/uncancel', 'lines', 'uncancel-line'],
    ['POST /v1/lines/{id}/anniversary', 'lines', 'set-line-anniversary'],
    ['POST /v1/lines/{id}/variant', 'lines', 'change-line-variant'],
    ['DELETE /v1/lines/{id}/variant', 'lines', 'cancel-variant-change'],
    ['POST /v1/lines/{id}/convert-to-test', 'lines', 'convert-to-test-line'],
    ['POST /v1/lines/{id}/convert-from-test', 'lines', 'convert-from-test-line'],
    ['POST /v1/lines/{id}/transfer-ownership', 'lines', 'transfer-line']
  ]],
  ['Line configuration and state', [
    ['GET /v1/lines/{id}/config', 'lines', 'get-line-config'],
    ['PATCH /v1/lines/{id}/config', 'lines', 'update-line-config'],
    ['GET /v1/lines/{id}/quota', 'lines', 'get-line-sending-limits'],
    ['GET /v1/lines/{id}/queue', 'lines', 'get-line-queue'],
    ['GET /v1/lines/{id}/health', 'lines', 'get-line-health'],
    ['GET /v1/attention', 'lines', 'list-attention']
  ]],
  ['Webhook subscriptions', [
    ['POST /v1/webhooks', 'webhooks', 'create-webhook'],
    ['GET /v1/webhooks', 'webhooks', 'list-webhooks'],
    ['GET /v1/webhooks/{id}', 'webhooks', 'get-webhook'],
    ['PATCH /v1/webhooks/{id}', 'webhooks', 'update-webhook'],
    ['DELETE /v1/webhooks/{id}', 'webhooks', 'delete-webhook'],
    ['POST /v1/webhooks/{id}/rotate-secret', 'webhooks', 'rotate-webhook-secret'],
    ['GET /v1/webhooks/{id}/deliveries', 'webhooks', 'list-webhook-deliveries'],
    ['POST /v1/webhooks/{id}/deliveries/{delivery_id}/replay', 'webhooks', 'replay-webhook-delivery'],
    ['GET /v1/webhooks/events', 'webhooks', 'list-webhook-events']
  ]],
  ['Trials', [
    ['POST /v1/trial/init', 'trials', 'start-trial'],
    ['GET /v1/trial/status', 'trials', 'get-trial-status'],
    ['GET /v1/trial/activity', 'trials', 'get-trial-activity'],
    ['GET /v1/trial/{trial_id}', 'trials', 'get-trial'],
    ['PATCH /v1/trial/{trial_id}', 'trials', 'update-trial'],
    ['POST /v1/trial/{trial_id}/revoke', 'trials', 'revoke-trial']
  ]],
  ['BYOD', [
    ['POST /v1/byod/pair', 'byod', 'start-byod-pairing'],
    ['GET /v1/apps', 'byod', 'get-app-downloads']
  ]],
  ['Pre-orders', [
    ['POST /v1/pre-orders', 'pre-orders', 'create-pre-order'],
    ['GET /v1/pre-orders', 'pre-orders', 'list-pre-orders'],
    ['GET /v1/pre-orders/{id}', 'pre-orders', 'get-pre-order'],
    ['PATCH /v1/pre-orders/{id}', 'pre-orders', 'update-pre-order'],
    ['POST /v1/pre-orders/{id}/confirm', 'pre-orders', 'confirm-pre-order'],
    ['POST /v1/pre-orders/{id}/cancel', 'pre-orders', 'cancel-pre-order'],
    ['GET /v1/area-codes', 'pre-orders', 'list-area-codes']
  ]],
  ['Hosted macOS sessions', [
    ['POST /v1/macos-sessions/rent', 'macos-sessions', 'rent-macos-session'],
    ['GET /v1/macos-sessions/{id}', 'macos-sessions', 'get-macos-session'],
    ['PATCH /v1/macos-sessions/{id}', 'macos-sessions', 'update-macos-session'],
    ['POST /v1/macos-sessions/{id}/cancel', 'macos-sessions', 'cancel-macos-session'],
    ['POST /v1/macos-sessions/{id}/uncancel', 'macos-sessions', 'uncancel-macos-session']
  ]],
  ['Service', [
    ['GET /v1/health', 'service', 'get-health'],
    ['GET /v1/version', 'service', 'get-version']
  ]]
]

const METHODS = ['get', 'post', 'put', 'patch', 'delete']
const check = process.argv.includes('--check')
const stale = []
const errors = []

const read = path => readFileSync(join(ROOT, path), 'utf8')

// Writes are queued and applied at the end, so that an error leaves the tree untouched.
const queued = []

function write (path, content) {
  const full = join(ROOT, path)
  if (existsSync(full) && readFileSync(full, 'utf8') === content) return
  stale.push(path)
  queued.push([full, content])
}

const quote = text => JSON.stringify(text)

const spec = JSON.parse(read(SPEC_PATH))
const inSpec = new Map()
for (const [path, item] of Object.entries(spec.paths ?? {})) {
  for (const method of METHODS) {
    if (item[method]) inSpec.set(`${method.toUpperCase()} ${path}`, item[method])
  }
}

const groups = []
const named = new Set()
const pagePaths = new Set()
for (const [group, operations] of OPERATIONS) {
  const pages = []
  for (const [operation, dir, slug] of operations) {
    named.add(operation)
    const definition = inSpec.get(operation)
    if (!definition) {
      errors.push(`${operation}: in the OPERATIONS table but not in the spec`)
      continue
    }
    if (!definition.summary) {
      errors.push(`${operation}: the spec gives it no summary, so the page has no title`)
      continue
    }
    const page = `${REFERENCE_DIR}/${dir}/${slug}`
    if (pagePaths.has(page)) errors.push(`${page}: named by two operations`)
    pagePaths.add(page)
    pages.push(page)

    const file = `${page}.mdx`
    const title = `title: ${quote(definition.summary)}`
    const openapi = `openapi: ${quote(operation)}`
    if (!existsSync(join(ROOT, file))) {
      write(file, `---\n${title}\n${openapi}\n---\n`)
      continue
    }
    const content = read(file)
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---\n/)
    if (!frontmatter) {
      errors.push(`${file}: no frontmatter`)
      continue
    }
    let lines = frontmatter[1].split('\n')
    const set = (key, line) => {
      const index = lines.findIndex(existing => existing.startsWith(`${key}:`))
      if (index === -1) lines = key === 'title' ? [line, ...lines] : [...lines, line]
      else lines[index] = line
    }
    set('title', title)
    set('openapi', openapi)
    write(file, `---\n${lines.join('\n')}\n---\n${content.slice(frontmatter[0].length)}`)
  }
  if (pages.length) groups.push({ group, pages })
}

for (const operation of inSpec.keys()) {
  if (!named.has(operation)) errors.push(`${operation}: in the spec but not in the OPERATIONS table`)
}

// A page that no entry names would stay published and out of the navigation.
const walk = dir => readdirSync(join(ROOT, dir)).flatMap(name => {
  const path = `${dir}/${name}`
  return statSync(join(ROOT, path)).isDirectory() ? walk(path) : [path]
})
for (const file of walk(REFERENCE_DIR)) {
  if (!file.endsWith('.mdx')) continue
  const page = file.slice(0, -'.mdx'.length)
  if (page !== OVERVIEW_PAGE && !pagePaths.has(page)) errors.push(`${file}: no operation names this page`)
}

const docs = JSON.parse(read(DOCS_JSON))
const tab = docs.navigation?.tabs?.find(candidate => candidate.tab === TAB)
if (!tab) {
  errors.push(`${DOCS_JSON}: no "${TAB}" tab`)
} else {
  const overview = tab.groups?.[0]
  if (!overview?.pages?.includes(OVERVIEW_PAGE)) {
    errors.push(`${DOCS_JSON}: the first group of the "${TAB}" tab must hold ${OVERVIEW_PAGE}`)
  } else {
    tab.groups = [overview, ...groups]
    write(DOCS_JSON, JSON.stringify(docs, null, 2) + '\n')
  }
}

if (errors.length) {
  console.error(`generate-reference-pages: ${errors.length} error(s):`)
  for (const error of errors) console.error(`  ${error}`)
  process.exit(1)
}
if (check && stale.length) {
  console.error(`generate-reference-pages: ${stale.length} stale file(s):`)
  for (const file of stale) console.error(`  ${file}`)
  process.exit(1)
}
for (const [full, content] of queued) {
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}
console.log(`generate-reference-pages: ${inSpec.size} operations, ${stale.length} file(s) ${check ? 'stale' : 'written'}`)
