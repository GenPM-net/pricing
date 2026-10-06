// @core/pricing — API pública. Importa desde aquí.
export { priceRulesAdminResource } from './admin.js';
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
} from './pricing.js';
export { type PriceRule, priceHistory, priceRules } from './schema.js';
