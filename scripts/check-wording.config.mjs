// Project settings of the wording gate (scripts/check-wording.mjs). Patterns are [RegExp, 'why']
// pairs; the reason is printed with each hit.
//
// The internal names that the pages must never contain are not listed in this public repository:
// published, the list would name exactly what it guards. The gate reads them from a private module
// whose path is in the environment variable ISNAP_DOCS_PRIVATE_WORDING. That module exports
// PROJECT_FORBIDDEN and PROJECT_PROSE, in the form used below. Without the variable, the gate runs
// every other rule and prints a warning.

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PRIVATE_WORDING = process.env.ISNAP_DOCS_PRIVATE_WORDING
let privateWording = {}
if (!PRIVATE_WORDING) {
  console.warn('check-wording: warning: ISNAP_DOCS_PRIVATE_WORDING is not set, so the internal names are not checked. Set it to the path of the private wording module before publishing.')
} else if (!existsSync(resolve(PRIVATE_WORDING))) {
  console.error(`check-wording: ISNAP_DOCS_PRIVATE_WORDING names a file that does not exist: ${PRIVATE_WORDING}`)
  process.exit(2)
} else {
  privateWording = await import(pathToFileURL(resolve(PRIVATE_WORDING)).href)
}

export const SPEC_PATHS = ['api-reference/openapi.json']
export const CONFIG_PATHS = ['docs.json']
export const HISTORY_PAGES = ['changelog.mdx']

// Patterns that must appear nowhere, code samples included: the private internal names, then the
// rules of the samples.
export const PROJECT_FORBIDDEN = [
  ...(privateWording.PROJECT_FORBIDDEN ?? []),
  [/\+1555555\d{4}\b/, 'use the sample numbers +14155550123 and +14155550124 (these fail phone validation)'],
  // The API version these docs describe is written in the first entry of changelog.mdx and in the
  // versioning section of api-reference/introduction.mdx, and nowhere else. The sample response of
  // GET /v1/version in quickstart.mdx shows "2.45.0".
  [/(?<!starts at version |pages describe version |<Update label=")\b2\.[3-9]\d\.\d+\b(?<!"version": "2\.45\.0)/, 'an explicit API version: it is written only in the first entry of changelog.mdx and in the versioning section of api-reference/introduction.mdx'],
  [/new ISnapClient\(\{ apiKey: process\.env\.ISNAP_\w+ \?\? '' \}\)/, 'sample clients pass maxRetries: 2'],
  [/new ISnapClient\(\{(?![^}]*maxRetries)[^}]*\}\)/, 'sample clients pass maxRetries: 2'],
  // The title of a fenced block joins its first line: "```bash curl curl -sS ...".
  [/(?<!```\w+ )\bcurl (?!-sS\b)/, 'samples use curl -sS'],
  [/https:\/\/example\.com\b/, 'sample webhook URLs use https://hooks.your-domain.example/isnap'],
  // The sandbox, in any case and anywhere (prose, code, link targets): only on a page whose title ends with
  // "(private alpha)". The gate joins title, sidebarTitle and description in frontmatter order, so ^\n[^\n]* is
  // the first of them: keep title first in every page's frontmatter.
  [/[Ss][Aa][Nn][Dd][Bb][Oo][Xx](?<!^\n[^\n]*\(private alpha\)\n[\s\S]*)/, 'the sandbox is named only on a page whose title ends with "(private alpha)"; a test key acts on the same account and billing']
]

// Prose only: implementation words and the glossary's forbidden synonyms. Field, path, event and
// code names are in code format and are not checked by these.
export const PROJECT_PROSE = [
  ...(privateWording.PROJECT_PROSE ?? []),
  [/\bcron\b/i, 'implementation: a scheduler'],
  [/\b(database|db) (table|row|column)s?\b/i, 'implementation: the database'],
  [/\bmigrations?\b/i, 'implementation: the database'],
  [/\bJWTs?\b/, 'term: "dashboard session"'],
  [/\bthe bridge\b(?! app)/i, 'term: "the bridge app" for the software, "the line\'s device" for what sends'],
  [/\btapbacks?\b/i, 'term: "reaction"'],
  // A word inside a path, such as an old URL that docs.json redirects, is not prose.
  [/(?<!\/[\w-]*)\bquotas?\b/i, 'term: "sending limit" in prose; the names that contain "quota" stay in code format'],
  [/(?<!\/[\w-]*)\bwarm(ing|-up| up)\b/i, 'a concept the API does not have'],
  [/\btags?\b/i, 'term: "metadata"'],
  [/\binstants?\b/i, 'term: "timestamp"'],
  [/(?<!wholesale )\bpartners?\b/i, 'term: address the reader as "you"; "wholesale partner" is the only partner term'],
  [/\bdevice (already )?holds\b|\biSnap (still|no longer) holds\b/i, '"hold" is for held messages: "the device has taken", "iSnap keeps"'],
  [/\bshared fleets?\b/i, 'term: "dedicated pool line" or the numbers of iSnap'],
  [/\bBYOD subscriptions?\b/i, 'term: "BYOD slots"'],
  [/\b(its|the) subscription (ends|ended)\b/i, 'term: "per-line subscription"'],
  [/\bserved by a Mac\b/i, 'term: "iMessage line"'],
  [/\b(rented|BYOD) iPhone lines?\b/i, 'term: "rented iMessage line", "BYOD iMessage line"'],
  [/\bApple Accounts?\b/, 'term: "Apple ID" in prose'],
  [/(?<!Messages |\/)\bconversations?\b/i, 'term: "chat", "group chat" or "Messages conversation"'],
  [/\b(the|an|its|their) answers? (of|after|that arrives)\b|\b[Aa]nswer first\b|\bno answer within\b/, 'calque: "response"'],
  [/\bsend(s|ing)? (it|the request|the same request) again\b/i, 'idiom: "resend"'],
  [/\b(gives? (its|the) place back|place left)\b/i, 'calque: "stops counting", "room"'],
  [/\balso (after|while)\b/i, 'calque: "even after", "even while"'],
  [/\b(a|the|at) confirm\b(?! (call|operation|response|request))/i, 'noun: "confirmation"'],
  [/\bbilling (date|day)\b|\brenewal dates?\b/i, 'term: "anniversary", "billing anchor"'],
  [/\b(pass|check) that runs\b|\bonce an hour\b|\blooks for [^.]{0,40}every\b/i, 'implementation cadence: state the bound, or "the API does not bound the delay"'],
  [/\b(among other (causes|cases)|most events|some refusals)\b/i, 'hedge'],
  [/\b(try|call|retry) (again )?later\b/i, 'hedge: give the delay, or say there is none'],
  [/\b(first|second) table\b|\btables? above\b/i, 'positional reference: link the heading'],
  [/\bcounts? toward\b/i, 'one verb: "counts against"'],
  [/(?<!unanswered-)\bsend limits?\b/i, 'term: "unanswered-send limit" (trials) or "sending limit"'],
  [/\bbooked\b/i, 'term: "scheduled"'],
  [/\b\d+ (GB|MB)\b/, 'binary sizes: bytes, GiB, MiB'],
  [/\bpulling events\b|\bpull endpoint\b/i, 'term: "events feed"'],
  [/\bRefunds\b/, 'the heading suggests money: "Messages that stop counting"'],
  [/\bfit to (acquire|be)\b|\bthe possibility to\b|\bof its stock\b|\bthe one of\b|\b(can meet|you meet|where you meet)\b/i, 'calque'],
  [/\btrial lines?\b/i, 'term: "pool line"'],
  [/\bdelivery semantics\b/i, 'title: "Delivery guarantees"'],
  [/\b(pay|pays|paid|payments?|buy|buys|bought|rents?|adds? one)\b[^.]{0,80}\bsupport@isnap\.ai\b/i, 'payment by email: a direct account pays in the iSnap dashboard (concepts.mdx, Accounts)'],
  [/\b(no|any) operation that an API key can call takes a payment\b/i, 'false: a transfer and a pre-order confirmation charge']
]

// The one sentence that ties the API's term to Apple's: "A reaction is an iMessage tapback."
export const PROJECT_ALLOWED = [
  /\biMessage tapbacks?\b/,
  // Event type names are contract names, also where frontmatter forbids code format.
  /\b[a-z_]+\.cancelled\b/
]

export const PROJECT_ACRONYMS = ['BYOD', 'CAF', 'PNG', 'JPEG', 'NAT', 'MIT', 'ZIP']
