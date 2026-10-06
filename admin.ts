// Panel: reglas de precio.
import { asc, count, eq } from 'drizzle-orm';
import type { AdminContext, AdminResource } from '../contracts/index.ts';
import { getDb } from '../db/index.ts';
import { PriceRuleInput, upsertPriceRule } from './pricing.ts';
import { type PriceRule, priceRules } from './schema.ts';

class PricingForbidden extends Error {
  readonly code = 'forbidden';
}
async function need(ctx: AdminContext, action: 'read' | 'update') {
  if (!(await ctx.can(`pricing:${action}`))) throw new PricingForbidden(`forbidden: pricing:${action}`);
}

export const priceRulesAdminResource: AdminResource<PriceRule> = {
  name: 'price-rules',
  label: { singular: 'Price rule', plural: 'Price rules' },
  group: 'Store',
  fields: [
    { name: 'name', label: 'Name', type: 'text', required: true, list: true },
    { name: 'scope', label: 'Applies to', type: 'select', list: true, options: ['all', 'category', 'supplier', 'product'].map((v) => ({ value: v, label: v })) },
    { name: 'scopeValue', label: 'Category slug / supplier id / product id', type: 'text' },
    { name: 'minCost', label: 'From cost', type: 'money' },
    { name: 'maxCost', label: 'To cost', type: 'money' },
    { name: 'markupBps', label: 'Markup (basis points, 15000 = +150%)', type: 'number', required: true, list: true },
    { name: 'fixedAdd', label: 'Fixed amount added', type: 'money' },
    { name: 'rounding', label: 'Price ending', type: 'select', options: ['none', '.99', '.95', '.90', '.00'].map((v) => ({ value: v, label: v })) },
    { name: 'minMarginBps', label: 'Minimum margin (bps)', type: 'number' },
    { name: 'priority', label: 'Priority', type: 'number' },
    { name: 'active', label: 'Active', type: 'boolean', list: true },
  ],
  input: PriceRuleInput,
  title: (r) => r.name,
  async list(q, ctx) {
    await need(ctx, 'read');
    const [total] = await getDb().select({ n: count() }).from(priceRules);
    return { rows: await getDb().select().from(priceRules).orderBy(asc(priceRules.scope), asc(priceRules.priority)).limit(q.pageSize).offset((Math.max(q.page, 1) - 1) * q.pageSize), total: total?.n ?? 0 };
  },
  async get(id, ctx) {
    await need(ctx, 'read');
    const [r] = await getDb().select().from(priceRules).where(eq(priceRules.id, id));
    return r ?? null;
  },
  async create(input, ctx) {
    await need(ctx, 'update');
    return upsertPriceRule(input as never);
  },
  async update(id, input, ctx) {
    await need(ctx, 'update');
    return upsertPriceRule(input as never, id);
  },
  async delete(id, ctx) {
    await need(ctx, 'update');
    await getDb().delete(priceRules).where(eq(priceRules.id, id));
  },
};
