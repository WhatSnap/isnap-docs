#!/usr/bin/env node
// Imports the published iSnap OpenAPI document into api-reference/openapi.json, the only spec this
// site renders.
//
//   node scripts/import-openapi.mjs            fetch the production document
//   node scripts/import-openapi.mjs <file>     read a local document instead (to preview a change)
//   node scripts/import-openapi.mjs --check    change nothing; exit 1 when the committed copy is stale
//
// The published document describes every `/v1` operation, including the ones that only a dashboard
// session can call. This site documents what an API key, a trial key or an anonymous caller can call,
// so the import keeps the `/v1` paths and drops the dashboard-session operations listed below. It also
// pins the production server. Never edit api-reference/openapi.json by hand: its texts are written in
// the API itself.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT = join(ROOT, 'api-reference/openapi.json')
const SOURCE_URL = 'https://spec.isnap.ai/prod/openapi.json'
const SERVER = 'https://api.isnap.ai'

// Operations that accept a dashboard session only: an API key is refused with 401.
const DASHBOARD_ONLY_PREFIXES = ['/v1/api-keys', '/v1/billing/']

const METHODS = ['get', 'post', 'put', 'patch', 'delete']

const args = process.argv.slice(2)
const check = args.includes('--check')
const file = args.find(arg => !arg.startsWith('--'))

async function load () {
  if (file) return readFileSync(resolve(file), 'utf8')
  const response = await fetch(SOURCE_URL)
  if (!response.ok) throw new Error(`${SOURCE_URL}: HTTP ${response.status}`)
  return response.text()
}

/** Every `#/components/...` reference reachable from `node`, followed through the components. */
function reachable (spec, roots) {
  const seen = new Set()
  const visit = node => {
    if (Array.isArray(node)) return node.forEach(visit)
    if (node === null || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string' && value.startsWith('#/components/')) {
        if (seen.has(value)) continue
        seen.add(value)
        const [, , section, name] = value.split('/')
        visit(spec.components?.[section]?.[name])
      } else {
        visit(value)
      }
    }
  }
  roots.forEach(visit)
  return seen
}

const spec = JSON.parse(await load())

const kept = {}
const dropped = []
for (const [path, item] of Object.entries(spec.paths ?? {})) {
  const dashboardOnly = DASHBOARD_ONLY_PREFIXES.some(prefix => path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`))
  if (path.startsWith('/v1/') && !dashboardOnly) kept[path] = item
  else dropped.push(path)
}
spec.paths = kept
spec.servers = [{ url: SERVER }]

// Components that only the dropped operations used would render as orphan schemas: prune them.
const used = reachable(spec, [spec.paths, spec.security ?? []])
for (const [section, entries] of Object.entries(spec.components ?? {})) {
  if (section === 'securitySchemes') continue
  for (const name of Object.keys(entries)) {
    if (!used.has(`#/components/${section}/${name}`)) delete entries[name]
  }
}

const output = JSON.stringify(spec, null, 2) + '\n'
const operations = Object.values(kept).reduce((count, item) => count + METHODS.filter(method => item[method]).length, 0)

if (check) {
  const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : ''
  if (current !== output) {
    console.error(`import-openapi: api-reference/openapi.json is stale (published version ${spec.info?.version})`)
    process.exit(1)
  }
  console.log(`import-openapi: up to date (version ${spec.info?.version}, ${operations} operations)`)
} else {
  mkdirSync(dirname(OUTPUT), { recursive: true })
  writeFileSync(OUTPUT, output)
  console.log(`import-openapi: version ${spec.info?.version}, ${operations} operations kept, ${dropped.length} paths dropped`)
  console.log(`  source: ${file ? resolve(file) : SOURCE_URL}`)
  for (const path of dropped) console.log(`  dropped: ${path}`)
}
