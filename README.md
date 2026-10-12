# iSnap docs

Source of the iSnap developer documentation, published with [Mintlify](https://mintlify.com).

## Structure

| Path | Content |
| --- | --- |
| `docs.json` | Site configuration and navigation. |
| `introduction.mdx`, `quickstart.mdx`, `concepts.mdx`, `authentication.mdx`, `ai-agents.mdx` | Getting started. |
| `guides/` | Messaging and line guides. |
| `pagination.mdx`, `idempotency.mdx`, `errors-and-rate-limits.mdx` | Rules that apply to every operation. |
| `webhooks/` | Webhook guides, and one page per event family under `webhooks/events/`. |
| `sdk/` | The TypeScript SDK, `@isnap/sdk`. |
| `api-reference/` | One page per operation, rendered from `api-reference/openapi.json`. |
| `changelog.mdx` | One entry per API version. |
| `scripts/` | The spec import, the reference page generator and the wording gate. |

## Updating the API reference

The reference renders the published OpenAPI document. Never edit `api-reference/openapi.json` by
hand: its texts are written in the API.

```bash
node scripts/import-openapi.mjs             # fetch the published document
node scripts/generate-reference-pages.mjs   # create missing pages, fix titles, write the navigation
```

A new operation needs an entry in the `OPERATIONS` table of `scripts/generate-reference-pages.mjs`.
The generator owns the `title` and `openapi` lines of a reference page and the groups of the "API
reference" tab of `docs.json` after the first one, which holds the overview and the changelog. The
description and the body of a page are written by hand.

## Checks before publishing

```bash
node scripts/import-openapi.mjs --check
node scripts/generate-reference-pages.mjs --check
ISNAP_DOCS_PRIVATE_WORDING=<path> node scripts/check-wording.mjs --spec
npx mint@latest broken-links --check-anchors
npx mint@latest validate
```

`import-openapi.mjs --check` compares the committed spec with the published one: run it once the
version these docs describe is in production.

The API version these docs describe is written in the `## Versioning and compatibility` section of
`api-reference/introduction.mdx`, and each version has an entry in `changelog.mdx`, with its release date. When a new
version changes the contract, add its changelog entry and update that section with the version that
`GET https://api.isnap.ai/v1/version` returns. The wording gate accepts an API version only in those places, in the
opening sentence of `changelog.mdx`, and in the sample response of `GET /v1/version`.

The wording gate enforces the writing rules of this site: the contract and never the implementation,
one name per concept, numbers instead of hedges. Its project settings are in
`scripts/check-wording.config.mjs`. The internal names that the pages must never contain are kept out of this
repository, in a module whose path the gate reads from the environment variable `ISNAP_DOCS_PRIVATE_WORDING`. Without
the variable, the gate prints a warning and checks everything else.

## Local preview

```bash
npx mint@latest dev
```

## Publishing

Mintlify deploys every push to `main`.
