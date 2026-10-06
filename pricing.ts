// Precio de venta desde el coste con reglas, cambios de precio con historial, "precio anterior" honesto y márgenes.
import { and, asc, desc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { categories, productCategories, productVariants, products } from '../catalog/index.js';
import type { Money } from '../contracts/index.js';
import { type Executor, getDb, withTransaction } from '../db/index.js';
import { charmPrice, money } from '../money/index.js';
import { type PriceRule, priceHistory, priceRules } from './schema.js';

export const PriceRuleInput = z
  .object({
    name: z.string().min(1).max(80),
    scope: z.enum(['all', 'category', 'supplier', 'product']).default('all'),
    scopeValue: z.string().max(120).nullish(),
    minCost: z.number().int().min(0).nullish(),
    maxCost: z.number().int().min(0).nullish(),
    markupBps: z.number().int().min(0).max(100_000),
    fixedAdd: z.number().int().min(0).default(0),
    rounding: z.enum(['none', '.99', '.95', '.90', '.00']).default('.99'),
    minMarginBps: z.number().int().min(0).max(9_900).default(1000),
    priority: z.number().int().default(0),
    active: z.boolean().default(true),
  })
  .refine((r) => r.scope === 'all' || !!r.scopeValue, 'scopeValue is required for this scope');

export async function upsertPriceRule(input: z.input<typeof PriceRuleInput>, id?: string, db: Executor = getDb()): Promise<PriceRule> {
  const r = PriceRuleInput.parse(input);
  const values = { ...r, scopeValue: r.scopeValue ?? null, minCost: r.minCost ?? null, maxCost: r.maxCost ?? null };
  const [row] = id ? await db.update(priceRules).set(values).where(eq(priceRules.id, id)).returning() : await db.insert(priceRules).values(values).returning();
  return row!;
}

export type PricingContext = { productId?: string; categorySlugs?: string[]; supplierId?: string };

const SPECIFICITY = { product: 3, supplier: 2, category: 1, all: 0 } as const;

/** Regla aplicable: la más específica (producto > proveedor > categoría > todo) y, a igualdad, la de mayor prioridad. */
export async function ruleFor(cost: Money, ctx: PricingContext, db: Executor = getDb()): Promise<PriceRule | null> {
  const rules = await db.select().from(priceRules).where(eq(priceRules.active, true));
  const fits = rules.filter(
    (r) =>
      (r.minCost == null || cost.amount >= r.minCost) &&
      (r.maxCost == null || cost.amount <= r.maxCost) &&
      (r.scope === 'all' ||
        (r.scope === 'product' && r.scopeValue === ctx.productId) ||
        (r.scope === 'supplier' && r.scopeValue === ctx.supplierId) ||
        (r.scope === 'category' && !!ctx.categorySlugs?.includes(r.scopeValue ?? ''))),
  );
  fits.sort((a, b) => SPECIFICITY[b.scope] - SPECIFICITY[a.scope] || b.priority - a.priority || a.id.localeCompare(b.id));
  return fits[0] ?? null;
}

/** Precio = coste × (1 + margen) + fijo, redondeado. */
export function applyRule(cost: Money, rule: Pick<PriceRule, 'markupBps' | 'fixedAdd' | 'rounding'>): Money {
  const raw = money(Math.round((cost.amount * (10_000 + rule.markupBps)) / 10_000) + rule.fixedAdd, cost.currency);
  return rule.rounding === 'none' ? raw : charmPrice(raw, rule.rounding);
}

/** Margen sobre el precio en puntos básicos (negativo = pérdida). */
export const marginBps = (price: number, cost: number) => (price <= 0 ? -10_000 : Math.round(((price - cost) * 10_000) / price));

export type PriceQuote = { price: Money; rule: PriceRule; marginBps: number; belowMinimum: boolean };

export async function priceFromCost(cost: Money, ctx: PricingContext = {}, db: Executor = getDb()): Promise<PriceQuote | null> {
  const rule = await ruleFor(cost, ctx, db);
  if (!rule) return null;
  const price = applyRule(cost, rule);
  const m = marginBps(price.amount, cost.amount);
  return { price, rule, marginBps: m, belowMinimum: m < rule.minMarginBps };
}

/**
 * Cambia el precio de una variante cerrando el periodo anterior del historial. No hace nada si no cambia.
 * Úsalo en lugar de actualizar `priceAmount` directamente.
 */
export async function setVariantPrice(variantId: string, amount: number, db = getDb(), at = new Date()): Promise<boolean> {
  return withTransaction(async (tx) => {
    const [v] = await tx.select().from(productVariants).where(eq(productVariants.id, variantId)).for('update');
    if (!v) throw new Error(`variant ${variantId} not found`);
    const [open] = await tx.select().from(priceHistory).where(and(eq(priceHistory.variantId, variantId), isNull(priceHistory.validTo)));
    if (v.priceAmount === amount && open) return false;
    if (open) await tx.update(priceHistory).set({ validTo: at }).where(eq(priceHistory.id, open.id));
    else if (v.priceAmount !== amount) await tx.insert(priceHistory).values({ variantId, amount: v.priceAmount, currency: v.currency, validFrom: v.createdAt, validTo: at });
    await tx.insert(priceHistory).values({ variantId, amount, currency: v.currency, validFrom: at });
    if (v.priceAmount !== amount) await tx.update(productVariants).set({ priceAmount: amount }).where(eq(productVariants.id, variantId));
    return true;
  }, db);
}

/**
 * Precio anterior a efectos de anunciar una rebaja: el más bajo de los 30 días previos al precio actual
 * (Directiva Ómnibus, art. 6 bis). Null si no hay historial suficiente.
 */
export async function priorPrice(variantId: string, db: Executor = getDb()): Promise<Money | null> {
  const [current] = await db.select().from(priceHistory).where(and(eq(priceHistory.variantId, variantId), isNull(priceHistory.validTo))).orderBy(desc(priceHistory.validFrom)).limit(1);
  if (!current) return null;
  const since = new Date(current.validFrom.getTime() - 30 * 86_400_000);
  const rows = await db
    .select()
    .from(priceHistory)
    .where(and(eq(priceHistory.variantId, variantId), lt(priceHistory.validFrom, current.validFrom), or(isNull(priceHistory.validTo), gt(priceHistory.validTo, since))))
    .orderBy(asc(priceHistory.amount))
    .limit(1);
  return rows[0] ? money(rows[0].amount, rows[0].currency) : null;
}

/** "Antes X" que se puede mostrar: el precio anterior honesto si es mayor que el actual; si no, nada. */
export async function honestCompareAt(variantId: string, db: Executor = getDb()): Promise<Money | null> {
  const [v] = await db.select().from(productVariants).where(eq(productVariants.id, variantId));
  const prior = await priorPrice(variantId, db);
  return v && prior && prior.amount > v.priceAmount ? prior : null;
}

/**
 * Recalcula con las reglas el precio de las variantes con coste de un producto. Devuelve los cambios y las alertas
 * de margen. Con `apply: false` solo simula.
 */
export async function repriceProduct(productId: string, opts: { apply?: boolean; supplierId?: string } = {}, db = getDb()) {
  const cats = await db.select({ slug: categories.slug }).from(productCategories).innerJoin(categories, eq(categories.id, productCategories.categoryId)).where(eq(productCategories.productId, productId));
  const [p] = await db.select({ id: products.id }).from(products).where(eq(products.id, productId));
  if (!p) throw new Error(`product ${productId} not found`);
  const variants = await db.select().from(productVariants).where(and(eq(productVariants.productId, productId), eq(productVariants.active, true)));
  const changes: Array<{ variantId: string; from: number; to: number; marginBps: number; belowMinimum: boolean }> = [];
  for (const v of variants) {
    if (v.costAmount == null) continue;
    const q = await priceFromCost(money(v.costAmount, v.currency), { productId, categorySlugs: cats.map((c) => c.slug), supplierId: opts.supplierId }, db);
    if (!q) continue;
    changes.push({ variantId: v.id, from: v.priceAmount, to: q.price.amount, marginBps: q.marginBps, belowMinimum: q.belowMinimum });
    if (opts.apply !== false && q.price.amount !== v.priceAmount) await setVariantPrice(v.id, q.price.amount, db);
  }
  return changes;
}

/** Variantes activas que se venden con margen por debajo de `minBps` (o con pérdida). */
export async function lowMarginVariants(minBps = 0, db: Executor = getDb()) {
  const rows = await db
    .select({ id: productVariants.id, sku: productVariants.sku, price: productVariants.priceAmount, cost: productVariants.costAmount, product: products.name, status: products.status })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(productVariants.active, true));
  return rows.filter((r) => r.cost != null && marginBps(r.price, r.cost) < minBps).map((r) => ({ ...r, marginBps: marginBps(r.price, r.cost!) }));
}
