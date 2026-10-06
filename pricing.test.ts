import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProduct, getProduct, upsertCategory } from '../catalog/index.ts';
import * as catalogSchema from '../catalog/schema.ts';
import type { AdminContext } from '../contracts/index.ts';
import { testDb } from '../db/__fixtures__/pglite.ts';
import type { Db } from '../db/index.ts';
import { money } from '../money/index.ts';
import * as schema from './schema.ts';
import {
  applyRule,
  honestCompareAt,
  lowMarginVariants,
  marginBps,
  priceFromCost,
  priceHistory,
  priceRulesAdminResource,
  priorPrice,
  repriceProduct,
  setVariantPrice,
  upsertPriceRule,
} from './index.ts';

let db: Db;
const eur = (n: number) => money(n, 'EUR');
const DAY = 86_400_000;

beforeEach(async () => {
  db = await testDb(catalogSchema, schema);
  process.env.STORE_CURRENCY = 'EUR';
  await upsertCategory({ slug: 'gadgets', name: 'Gadgets' });
});

describe('rules', () => {
  it('applies markup, fixed amount and charm rounding', () => {
    expect(applyRule(eur(720), { markupBps: 15000, fixedAdd: 0, rounding: '.99' })).toEqual(eur(1899)); // 18,00 → 18,99
    expect(applyRule(eur(720), { markupBps: 15000, fixedAdd: 0, rounding: 'none' })).toEqual(eur(1800));
    expect(applyRule(eur(1000), { markupBps: 10000, fixedAdd: 150, rounding: '.95' })).toEqual(eur(2195));
    expect(marginBps(2000, 1500)).toBe(2500);
    expect(marginBps(1000, 1200)).toBe(-2000);
  });

  it('picks the most specific matching rule, then priority, within cost ranges', async () => {
    await upsertPriceRule({ name: 'Default', markupBps: 10000 });
    await upsertPriceRule({ name: 'Cheap items', markupBps: 20000, maxCost: 500, priority: 1 });
    await upsertPriceRule({ name: 'Gadgets', scope: 'category', scopeValue: 'gadgets', markupBps: 15000 });
    await upsertPriceRule({ name: 'Supplier CJ', scope: 'supplier', scopeValue: 'sup_cj', markupBps: 12000 });
    expect((await priceFromCost(eur(1000)))?.rule.name).toBe('Default');
    expect((await priceFromCost(eur(400)))?.rule.name).toBe('Cheap items');
    expect((await priceFromCost(eur(400), { categorySlugs: ['gadgets'] }))?.rule.name).toBe('Gadgets');
    expect((await priceFromCost(eur(400), { categorySlugs: ['gadgets'], supplierId: 'sup_cj' }))?.rule.name).toBe('Supplier CJ');
    const q = (await priceFromCost(eur(1000)))!;
    expect([q.price.amount, q.marginBps, q.belowMinimum]).toEqual([2099, 5236, false]);
    await expect(upsertPriceRule({ name: 'x', scope: 'category', markupBps: 1 })).rejects.toThrow(/scopeValue/);
  });
});

describe('price history and honest compare-at prices', () => {
  async function variant(price = 2000, cost: number | null = 800) {
    const slug = `p${Math.random().toString(36).slice(2, 8)}`;
    await createProduct({ slug, name: 'Gadget', status: 'active', categories: ['gadgets'], variants: [{ price, cost }] });
    return (await getProduct(slug))!.variants[0]!.id;
  }

  it('records each change and computes the lowest price of the 30 days before the current one', async () => {
    const id = await variant(2000);
    const t0 = Date.now() - 60 * DAY;
    await setVariantPrice(id, 2000, db, new Date(t0));
    await setVariantPrice(id, 1800, db, new Date(t0 + 20 * DAY)); // hace 40 días
    await setVariantPrice(id, 2500, db, new Date(t0 + 45 * DAY)); // hace 15 días (subida antes de "rebajar")
    expect(await setVariantPrice(id, 2500, db, new Date(t0 + 46 * DAY))).toBe(false);
    await setVariantPrice(id, 1500, db, new Date(t0 + 59 * DAY)); // rebaja de ayer
    // En los 30 días previos a la rebaja estuvo a 1800 (hasta hace 15 días) y a 2500: el anterior honesto es 1800.
    expect(await priorPrice(id)).toEqual(eur(1800));
    expect(await honestCompareAt(id)).toEqual(eur(1800));
    expect((await db.select().from(priceHistory).where(eq(priceHistory.variantId, id))).length).toBe(4);
    expect((await getProduct((await db.select().from(catalogSchema.products))[0]!.slug))!.variants[0]!.price.amount).toBe(1500);
  });

  it('no compare-at when the price went up or there is no history', async () => {
    const id = await variant(2000);
    expect(await honestCompareAt(id)).toBeNull();
    await setVariantPrice(id, 1000, db, new Date(Date.now() - 10 * DAY));
    await setVariantPrice(id, 1200, db);
    expect(await honestCompareAt(id)).toBeNull(); // subió: no hay rebaja que anunciar
  });

  it('reprices a product from cost with rules and flags low margins', async () => {
    await upsertPriceRule({ name: 'Gadgets', scope: 'category', scopeValue: 'gadgets', markupBps: 5000, rounding: '.99', minMarginBps: 4000 });
    await createProduct({ slug: 'g1', name: 'G1', status: 'active', categories: ['gadgets'], variants: [{ price: 999, cost: 1000 }] });
    const p = (await getProduct('g1'))!;
    expect((await lowMarginVariants(0)).map((v) => v.marginBps)).toEqual([-10]);
    const sim = await repriceProduct(p.id, { apply: false });
    expect(sim).toEqual([{ variantId: p.variants[0]!.id, from: 999, to: 1599, marginBps: 3746, belowMinimum: true }]);
    expect((await getProduct('g1'))!.variants[0]!.price.amount).toBe(999);
    await repriceProduct(p.id);
    expect((await getProduct('g1'))!.variants[0]!.price.amount).toBe(1599);
    expect(await lowMarginVariants(0)).toEqual([]);
  });

  it('admin needs pricing permissions', async () => {
    const ctx = (perms: string[]): AdminContext => ({ user: { id: 'u', email: null, name: null }, can: async (p) => perms.includes(p) });
    await priceRulesAdminResource.create!({ name: 'All', markupBps: 10000 }, ctx(['pricing:update']));
    expect((await priceRulesAdminResource.list({ page: 1, pageSize: 10 }, ctx(['pricing:read']))).total).toBe(1);
    await expect(priceRulesAdminResource.list({ page: 1, pageSize: 10 }, ctx([]))).rejects.toThrow(/forbidden/);
  });
});
