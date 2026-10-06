# @core/pricing — rules for AI agents

## Purpose
Turns costs into selling prices and keeps price changes honest. Rules (scope all / category / supplier / product,
cost range, markup in basis points, fixed add-on, charm rounding, minimum margin, priority) pick the most specific
match; `repriceProduct` applies them to variants with a cost. Every price change goes to `price_history`, which gives
the EU "prior price" (lowest of the 30 days before the current price) for any sale badge. Tables: `price_rules`, `price_history`.

## Map
- `index.ts` — public API: `upsertPriceRule`, `priceFromCost`, `applyRule`, `repriceProduct`, `setVariantPrice`, `priorPrice`, `honestCompareAt`, `lowMarginVariants`, `priceRulesAdminResource`.
- `pricing.ts` — logic. `admin.ts` — admin resource. `schema.ts` — tables.

## Integration
1. Migrations as in `src/lib/db/AGENTS.md`.
2. Create rules in the admin (`priceRulesAdminResource` in `src/genpm/admin.ts`, permissions `pricing:read|update`), e.g. `markupBps: 15000` (+150 %), rounding `.99`.
3. Change prices only with `setVariantPrice(variantId, amount)` (also from the admin and supplier syncs) so history is kept.
4. Product pages: show a crossed-out price only with `honestCompareAt(variantId)`; never with a typed "compare at".
5. Simulate before applying: `repriceProduct(productId, { apply: false })` returns old/new price and margin per variant.
6. Verify: lower a price, `honestCompareAt` returns the lowest price of the previous 30 days.

## Conventions
- Amounts in minor units; markup and margins in basis points (10000 = 100 %).
- Review `lowMarginVariants()` after cost changes; items below their rule's minimum must not be sold silently.

## Don't
- Don't update `priceAmount` directly or invent "was" prices; that breaks the 30-day rule (Omnibus Directive).
- Don't raise a price shortly before a sale to inflate the discount.
- Don't expose costs or margins in public pages or APIs.
