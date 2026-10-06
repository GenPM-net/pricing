// @core/pricing — API pública. Importa desde aquí.
export { priceRulesAdminResource } from './admin.ts';
export {
  applyRule,
  honestCompareAt,
  lowMarginVariants,
  marginBps,
  type PriceQuote,
  PriceRuleInput,
  type PricingContext,
  priceFromCost,
  priorPrice,
  repriceProduct,
  ruleFor,
  setVariantPrice,
  upsertPriceRule,
} from './pricing.ts';
export { type PriceRule, priceHistory, priceRules } from './schema.ts';
