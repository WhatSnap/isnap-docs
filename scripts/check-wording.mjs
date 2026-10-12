#!/usr/bin/env node
// Wording gate of the /doc-write skill. Copy it to <docs repo>/scripts/check-wording.mjs, fill the
// PROJECT section below, and run it before every publish:
//
//   node scripts/check-wording.mjs            pages, site config, and FORBIDDEN on the spec
//   node scripts/check-wording.mjs --spec     also the prose rules on the spec's descriptions
//   node scripts/check-wording.mjs --root D   check the site in D instead of the script's parent
//   node scripts/check-wording.mjs --changed R only the files changed since git ref R, and new files
//
// The project's settings live in scripts/check-wording.config.mjs of the docs repo (a template ships
// with the skill), so this file can be replaced as a whole when the skill's rules improve.
//
// Three groups of checks:
//   - FORBIDDEN: implementation details, internal names, comparisons with another product. They run
//     on the raw text, code blocks included, since a sample can leak them too.
//   - PROSE: the rules every page follows (placeholders, filler, hedges, history, calques, British
//     spelling, terms, capitals for emphasis). They run on prose only: fenced code, inline code, link
//     targets and MDX comments are skipped, because field names and payloads are part of the contract.
//   - FORM: the frontmatter of each page. A title has no "&", a description ends with a period, and
//     the body does not open with a heading.
// The lines of one paragraph are joined before matching, so a phrase that a hard wrap splits is still
// found. Each problem is reported at the line where its match starts.
//
// The spec is checked on its `description` and `summary` strings: FORBIDDEN always, PROSE with
// --spec (its prose is usually written in a backend, and fixed there). PROSE skips generated pages
// and GENERATED blocks, whose text is copied from the spec.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const argRoot = process.argv.indexOf('--root')
const ROOT = argRoot !== -1 ? process.argv[argRoot + 1] : join(dirname(fileURLToPath(import.meta.url)), '..')
const argChangedIndex = process.argv.indexOf('--changed')
if (!ROOT || ROOT.startsWith('--') || (argChangedIndex !== -1 && !(process.argv[argChangedIndex + 1] ?? '').trim())) {
  console.error('usage: check-wording.mjs [--root <dir>] [--spec] [--changed <git ref>]')
  process.exit(2)
}
const checkSpecProse = process.argv.includes('--spec')
// --changed <ref>: check only the files changed since <ref>, and new files. For a site that has not
// passed the gate yet: the pages you touch leave clean, and the backlog is its own change.
const argChanged = process.argv.indexOf('--changed')
const git = args => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).split('\n').filter(Boolean)
const CHANGED = argChanged === -1
  ? null
  : new Set([
    ...git(['diff', '--relative', '--name-only', '--diff-filter=ACMR', process.argv[argChanged + 1]]),
    ...git(['ls-files', '--others', '--exclude-standard'])
  ])
const inScope = file => CHANGED === null || CHANGED.has(file)

// ---------------------------------------------------------------------------------------------
// PROJECT settings: scripts/check-wording.config.mjs in the docs repo. Every export is optional; the
// defaults below apply to what it leaves out. See check-wording.config.template.mjs in the skill.
// ---------------------------------------------------------------------------------------------

const settingsPath = join(ROOT, 'scripts', 'check-wording.config.mjs')
const config = existsSync(settingsPath) ? await import(pathToFileURL(settingsPath).href) : {}

// Specs whose `description` and `summary` strings are checked. Missing files are skipped.
const SPEC_PATHS = config.SPEC_PATHS ?? ['api-reference/openapi.json']
// Site configuration files, checked line by line. Missing files are skipped.
const CONFIG_PATHS = config.CONFIG_PATHS ?? ['docs.json', 'mint.json']
// Page files. The repository files at the root are not pages.
const PAGE_EXTENSIONS = config.PAGE_EXTENSIONS ?? ['.mdx', '.md']
const IGNORED_FILES = config.IGNORED_FILES ?? ['README.md', 'CHANGELOG.md', 'CLAUDE.md', 'AGENTS.md', 'CONTRIBUTING.md']
// Pages whose body a script writes from the spec, and the markers of generated blocks: PROSE skips
// them. A stub that a script created and a person then wrote is not generated.
const GENERATED_PAGE_PREFIXES = config.GENERATED_PAGE_PREFIXES ?? []
const GENERATED_BEGIN = config.GENERATED_BEGIN ?? '{/* BEGIN GENERATED'
const GENERATED_END = config.GENERATED_END ?? '{/* END GENERATED'
// Pages where history belongs: the history and roadmap rules skip them.
const HISTORY_PAGES = config.HISTORY_PAGES ?? ['changelog.mdx', 'changelog.md']
// Internal names that must appear nowhere, code samples included: internal applications, hosts, teams.
const PROJECT_FORBIDDEN = config.PROJECT_FORBIDDEN ?? []
// Implementation words, the glossary's forbidden synonyms, and project calques: prose only, so a
// consumer's own sample (its database, its queue, its tunnel) and contract field names pass.
const PROJECT_PROSE = config.PROJECT_PROSE ?? []
// The product's own acronyms, accepted in prose besides the common ones below.
const PROJECT_ACRONYMS = config.PROJECT_ACRONYMS ?? []
// Phrases the prose rules must not flag, because they are product terms: masked before matching.
// For example [/\blegacy license keys?\b/i] when "legacy license key" names a kind of access.
const PROJECT_ALLOWED = config.PROJECT_ALLOWED ?? []

// ---------------------------------------------------------------------------------------------
// Universal rules: change them in the skill, not per project.
// ---------------------------------------------------------------------------------------------

const FORBIDDEN = [
  ...PROJECT_FORBIDDEN,
  [/\bto be confirmed\b/i, 'placeholder']
]

const PROSE = [
  [/—/, 'em dash: use a colon, a comma or two sentences'],
  // Universal rules.
  [/\b(TODO|TBD|FIXME|XXX)\b/, 'placeholder'],
  [/\bto be (defined|decided)\b/i, 'placeholder'],
  [/\b(simply|obviously|of course|basically)\b/i, 'filler word'],
  [/\bjust (call|use|send|add|set|run)\b/i, 'filler "just"'],
  [/\betc\.?(?=\s|$)/i, '"etc.": list the items or say "for example"'],
  [/\bclick here\b/i, 'link text must name its target'],
  [/\bas (mentioned|stated|described) (above|below|earlier)\b/i, 'link to the section instead'],
  [/\b(for now|at the moment|as of now|used to (?:be|have|work|return|send|accept)|in the future|will soon|currently (?:only|not|does|doesn't|supports?|offers?|fires?|exposes?|available))\b/i, 'history or time-bound wording'],
  [/\bplease\b/i, 'instructions are imperative'],
  [/\be\.g\.|\bi\.e\./i, 'write "for example" or "that is"'],
  [/\w!(?=\s|$)/, 'no exclamation marks in prose'],
  // Rule 7: a number or a rule, not a hedge. Where a statement has no bound, say so.
  [/\b(usually|sometimes|shortly|recently|roughly|approximately|once or twice|and so on)\b/i, 'hedge: give a number, or say that there is no bound'],
  [/\b(several|a few) (seconds|minutes|hours|days|attempts|times)\b|\babout \d/i, 'vague quantity: give a number'],
  // Rule 6: no history and no roadmap. Narrow a pattern in PROJECT_PROSE's place if a term is legitimate
  // (for example a product term such as "legacy license key": use (?! license) after legacy).
  [/\b(legacy|older (versions|accounts|records|resources)|formerly|anymore|any more|current format)\b/i, 'history of the product'],
  [/\b(?:not|n't) yet (?:supported|available|implemented|exposed|shipped|live|released|public|possible)\b|\b(?:does|do)(?:n't| not) yet\b/i, '"yet" describes a roadmap: state the current behavior'],
  [/\b(?:will (?:add|ship|support|be (?:added|available|supported))|Phase \d)\b|\b(?:only|surface|available) today\b/i, 'roadmap: state the current behavior'],
  // Rule 8: American English and idiomatic constructions.
  [/\b(is|are|be|been|was|were) answered\b/i, 'calque: "the API returns X", "X receives Y"'],
  [/\banswers `/, 'calque: "returns"'],
  [/\bin any letter case\b/i, 'calque: "case-insensitive"'],
  [/\bfrom \d+ characters\b/i, 'calque: "of N or more characters"'],
  [/\bsends? again\b/i, 'calque: "resends"'],
  [/\b(?:sends?|returns?|responds?|answers?) at once\b/i, 'calque: "immediately"'],
  [/\bfrom the next \w+ on\b/i, 'calque: "starting with the next ..."'],
  [/\b(cancell(ed|ing)|behaviour|colour|favour|catalogue|licence|labelled|modelled|whilst|amongst|towards|afterwards|(organi|recogni|authori|seriali|synchroni|initiali|normali|customi|prioriti|optimi)s(e|ed|es|ing|ation))\b/i, 'British spelling'],
  // One name per concept: the project's glossary.
  ...PROJECT_PROSE
]

// Upper-case words allowed in prose. Any other word of two or more capitals is emphasis.
const ACRONYMS = new Set([
  'API', 'APIs', 'HTTP', 'HTTPS', 'JSON', 'UTC', 'ISO', 'URL', 'URLs', 'MCP', 'SDK', 'SDKs', 'ID',
  'IDs', 'HMAC', 'SHA', 'TLS', 'REST', 'RPC', 'SMS', 'RCS', 'AI', 'LLM', 'CI', 'QR', 'GET', 'POST',
  'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'HTML', 'CSS', 'UTM', 'DNS', 'OK', 'JWT', 'CLI', 'UI',
  'CSV', 'PDF', 'SSO', 'CORS', 'UUID', 'YAML', 'MDX', 'MIME', 'RFC', 'IANA', 'IETF', 'URI', 'TTL', 'KB',
  'MB', 'GB', 'TB', 'US', 'USD', 'EUR', 'EU', 'UK', 'GDPR', 'PII', 'SIM', 'MMS', 'OTP', 'SKU', 'SLA', 'CRM',
  'ETA', 'ESM', 'CDN', 'IP', 'TCP', 'UDP', 'ASCII', 'UTF', 'XML', 'SSE', 'PR', 'OS', 'UX',
  ...PROJECT_ACRONYMS
])
// A capitalized word followed by a hyphen is part of a name, such as the CF-Access-Client-Id header.
const EMPHASIS = /\b[A-Z][A-Z]+s?\b(?!-)/g

const problems = []

function report (where, match, why) {
  const line = `${where}: "${match.trim()}": ${why}`
  if (!problems.includes(line)) problems.push(line)
}

/** Every match of every pattern in `text`, as [index, match, why]. */
function matches (text, patterns) {
  const found = []
  for (const [pattern, why] of patterns) {
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
    for (const match of text.matchAll(global)) found.push([match.index, match[0], why])
  }
  return found
}

function emphasis (text) {
  return [...text.matchAll(EMPHASIS)]
    .filter(match => !ACRONYMS.has(match[0]) && !ACRONYMS.has(match[0].replace(/s$/, '')) && !/^(TODO|TBD|FIXME|XXX)$/.test(match[0]))
    .map(match => [match.index, match[0], 'capitals for emphasis, or add the acronym to ACRONYMS'])
}

/** Inline code, link targets and one-line MDX comments out of one line of prose. */
function prose (line) {
  return line
    .replace(/`[^`]*`/g, '``')
    .replace(/\]\([^)]*\)/g, ']()')
    .replace(/\{\/\*.*?\*\/\}/g, '')
}

/**
 * Joins the lines of each paragraph with a space and separates blocks with a newline. A line opens a
 * new block when it is blank or starts a list item, a table row, a heading, a quote or a component.
 * Returns the text and the offset at which each line starts.
 */
function joinParagraphs (lines) {
  let text = ''
  const starts = []
  let open = false
  for (const { number, content } of lines) {
    const trimmed = content.trim()
    if (trimmed === '') {
      open = false
      continue
    }
    const opensBlock = /^([-*+] |\d+\. |\||#|>|<|\{)/.test(trimmed)
    text += open && !opensBlock ? ' ' : '\n'
    starts.push([text.length, number])
    text += trimmed
    open = true
  }
  return { text, starts }
}

function lineAt (starts, index) {
  let number = starts[0]?.[1] ?? 1
  for (const [start, line] of starts) {
    if (start > index) break
    number = line
  }
  return number
}

/** The project's allowed phrases, blanked with spaces of the same length: offsets and lines hold. */
function allow (text) {
  let masked = text
  for (const pattern of PROJECT_ALLOWED) {
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
    masked = masked.replace(global, phrase => ' '.repeat(phrase.length))
  }
  return masked
}

function checkJoined (file, lines, patterns, withEmphasis) {
  const { text: joined, starts } = joinParagraphs(lines)
  // Inline code, after the join so a span split by a hard wrap is found. Same length: line numbers hold.
  const text = withEmphasis ? allow(joined.replace(/`[^`\n]*`/g, code => '``' + ' '.repeat(code.length - 2))) : joined
  const found = matches(text, patterns)
  if (withEmphasis) found.push(...emphasis(text))
  for (const [index, match, why] of found) report(`${file}:${lineAt(starts, index)}`, match, why)
}

/** One value of a frontmatter line, without its quotes. */
function frontmatterValue (raw, next = []) {
  const value = raw.trim()
  if (/^[>|][-+]?$/.test(value)) return next.map(line => line.trim()).join(' ')
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
    if (value[0] === "'") return value.slice(1, -1).replace(/''/g, "'")
    try { return JSON.parse(value) } catch { return value.slice(1, -1) }
  }
  return value
}

function checkPage (path) {
  const file = relative(ROOT, path)
  const generatedPage = GENERATED_PAGE_PREFIXES.some(prefix => file.startsWith(prefix))
  const all = readFileSync(path, 'utf8').split(/\r?\n/)
  const raw = []
  const text = []
  let body = 0

  if (all[0] === '---') {
    const end = all.indexOf('---', 1)
    body = end + 1
    for (let i = 1; i < end; i++) {
      const field = /^(title|sidebarTitle|description):\s*(.*)$/.exec(all[i])
      if (!field) continue
      const next = []
      for (let j = i + 1; j < end && /^\s+\S/.test(all[j]); j++) next.push(all[j])
      const value = frontmatterValue(field[2], next)
      const where = `${file}:${i + 1}`
      if (field[1] === 'title' && value.includes('&')) report(where, value, 'title: write "and", not "&"')
      if (field[1] === 'description' && !value.endsWith('.')) report(where, value, 'description: one sentence that ends with a period')
      raw.push({ number: i + 1, content: value })
      text.push({ number: i + 1, content: generatedPage ? '' : value })
      raw.push({ number: i + 1, content: '' })
      text.push({ number: i + 1, content: '' })
    }
  }

  const first = all.slice(body).findIndex(line => line.trim() !== '')
  if (first !== -1 && /^\s*#/.test(all[body + first])) {
    report(`${file}:${body + first + 1}`, all[body + first], 'the page opens with a heading: open with a paragraph that says what the page is for')
  }

  let fence = null
  let comment = false
  let generated = generatedPage
  for (let i = body; i < all.length; i++) {
    const line = all[i]
    raw.push({ number: i + 1, content: line })
    const marker = /^\s*(`{3,}|~{3,})(.*)$/.exec(line)
    if (marker && fence === null) {
      fence = marker[1]
      text.push({ number: i + 1, content: '' })
      continue
    }
    if (fence !== null) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && marker[2].trim() === '') fence = null
      text.push({ number: i + 1, content: '' })
      continue
    }
    if (line.includes(GENERATED_BEGIN)) generated = true
    if (line.includes(GENERATED_END)) generated = generatedPage
    if (generated) {
      text.push({ number: i + 1, content: '' })
      continue
    }
    let content = line
    if (comment) {
      const close = content.indexOf('*/}')
      if (close === -1) content = ''
      else {
        content = content.slice(close + 3)
        comment = false
      }
    }
    content = content.replace(/\]\([^)]*\)/g, ']()').replace(/\{\/\*.*?\*\/\}/g, '')
    const open = content.indexOf('{/*')
    if (open !== -1) {
      content = content.slice(0, open)
      comment = true
    }
    text.push({ number: i + 1, content })
  }

  checkJoined(file, raw, FORBIDDEN, false)
  const prosePatterns = HISTORY_PAGES.some(page => file === page || file.endsWith(`/${page}`))
    ? PROSE.filter(([, why]) => !/^(history|"yet"|roadmap)/.test(why))
    : PROSE
  checkJoined(file, text, prosePatterns, true)
}

function pages (dir) {
  const found = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) found.push(...pages(path))
    else if (PAGE_EXTENSIONS.some(ext => name.endsWith(ext)) && !(dir === ROOT && IGNORED_FILES.includes(name))) found.push(path)
  }
  return found
}

function specTexts (node, path, out) {
  if (Array.isArray(node)) node.forEach((item, i) => specTexts(item, `${path}[${i}]`, out))
  else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if ((key === 'description' || key === 'summary') && typeof value === 'string') out.push([`${path}.${key}`, value])
      else specTexts(value, `${path}.${key}`, out)
    }
  }
  return out
}

/** The pages git knows about (tracked, or new and not ignored); a walk of the tree outside git. */
function sitePages () {
  try {
    return git(['ls-files', '--cached', '--others', '--exclude-standard'])
      .filter(file => PAGE_EXTENSIONS.some(ext => file.endsWith(ext)) && !IGNORED_FILES.includes(file))
      .filter(file => existsSync(join(ROOT, file)))
      .map(file => join(ROOT, file))
  } catch {
    return pages(ROOT)
  }
}

sitePages().filter(path => inScope(relative(ROOT, path))).sort().forEach(checkPage)

// Site configuration: its strings are single lines, checked where they stand.
for (const configPath of CONFIG_PATHS) {
  if (!existsSync(join(ROOT, configPath)) || !inScope(configPath)) continue
  readFileSync(join(ROOT, configPath), 'utf8').split(/\r?\n/).forEach((line, i) => {
    for (const [, match, why] of matches(line, FORBIDDEN)) report(`${configPath}:${i + 1}`, match, why)
    for (const [, match, why] of matches(prose(line), PROSE)) report(`${configPath}:${i + 1}`, match, why)
  })
}

for (const specPath of SPEC_PATHS) {
  if (!existsSync(join(ROOT, specPath)) || !inScope(specPath)) continue
  const spec = JSON.parse(readFileSync(join(ROOT, specPath), 'utf8'))
  for (const [where, text] of specTexts(spec, specPath, [])) {
    for (const [, match, why] of matches(text, FORBIDDEN)) report(where, match, why)
    if (checkSpecProse) {
      const specProse = allow(prose(text))
      for (const [, match, why] of [...matches(specProse, PROSE), ...emphasis(specProse)]) report(where, match, why)
    }
  }
}

problems.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
if (problems.length > 0) {
  console.error(`${problems.length} wording problem(s):\n${problems.join('\n')}`)
  process.exit(1)
}
console.log('wording ok')
