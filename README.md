# @core/pricing

[![genpm](https://api.genpm.net/v1/badge/@core/pricing.svg)](https://genpm.net/p/@core/pricing) ![license](https://img.shields.io/badge/license-MIT-blue)

> Pricing from cost: markup rules by category/supplier/product, charm rounding, margin alerts and EU 30-day price history

A [GenPM](https://genpm.net) module: **source code + AI rules + MCP config**, injected into your project instead of hidden in `node_modules`. The code lands in `src/lib/pricing`, pinned to a verified commit, and you own it.

## Install

```bash
genpm add @core/pricing
```

No genpm yet? `curl -fsSL https://genpm.net/install.sh | sh` (macOS/Linux), `irm https://genpm.net/install.ps1 | iex` (Windows), or one-off with `npx @genpm-net/cli add @core/pricing`.

Or let your AI agent do it: run `genpm mcp setup` once, then ask *"add @core/pricing with genpm"* in Claude Code, Cursor, VS Code, Windsurf, Codex or Gemini CLI. It shows you a dry-run plan before writing anything.

## What it does

Turns costs into selling prices and keeps price changes honest. Rules (scope all / category / supplier / product,
cost range, markup in basis points, fixed add-on, charm rounding, minimum margin, priority) pick the most specific
match; `repriceProduct` applies them to variants with a cost. Every price change goes to `price_history`, which gives
the EU "prior price" (lowest of the 30 days before the current price) for any sale badge. Tables: `price_rules`, `price_history`.

## Setup

After `genpm add`, follow these steps (your AI agent finds the same steps in `src/lib/pricing/AGENTS.md` and can do them for you):

1. Migrations as in `src/lib/db/AGENTS.md`.
2. Create rules in the admin (`priceRulesAdminResource` in `src/genpm/admin.ts`, permissions `pricing:read|update`), e.g. `markupBps: 15000` (+150 %), rounding `.99`.
3. Change prices only with `setVariantPrice(variantId, amount)` (also from the admin and supplier syncs) so history is kept.
4. Product pages: show a crossed-out price only with `honestCompareAt(variantId)`; never with a typed "compare at".
5. Simulate before applying: `repriceProduct(productId, { apply: false })` returns old/new price and margin per variant.
6. Verify: lower a price, `honestCompareAt` returns the lowest price of the previous 30 days.

## What's inside

Paths are relative to `src/lib/pricing`.

- `index.ts` — public API: `upsertPriceRule`, `priceFromCost`, `applyRule`, `repriceProduct`, `setVariantPrice`, `priorPrice`, `honestCompareAt`, `lowMarginVariants`, `priceRulesAdminResource`.
- `pricing.ts` — logic. `admin.ts` — admin resource. `schema.ts` — tables.

## At a glance

- **GenPM dependencies** (installed with it): [@core/db](https://genpm.net/p/@core/db), [@core/catalog](https://genpm.net/p/@core/catalog), [@core/money](https://genpm.net/p/@core/money), [@core/contracts](https://genpm.net/p/@core/contracts)
- **npm dependencies** (proposed, never installed without asking): `zod`
- **AI rules**: [`AGENTS.md`](AGENTS.md), loaded by your agent only when it works in `src/lib/pricing`

## Security

GenPM installs a 40-character commit SHA (never a branch), verifies an Ed25519-signed manifest, never runs install scripts and scans AI rules for prompt injection. Details: [genpm.net/docs/security](https://genpm.net/docs/security).

## License

MIT — see [LICENSE](LICENSE). Browse the full catalog at [genpm.net](https://genpm.net).
