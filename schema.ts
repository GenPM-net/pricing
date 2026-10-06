// Tablas de @core/pricing. Las recoge drizzle-kit vía src/lib/db/drizzle.config.ts.
import { boolean, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { productVariants } from '../catalog/index.ts';
import { primaryId, timestamps } from '../db/index.ts';

export const priceRules = pgTable('price_rules', {
  id: primaryId('prr'),
  name: text('name').notNull(),
  /** A qué aplica: todo, una categoría, un proveedor o un producto (slug/id en `scopeValue`). */
  scope: text('scope', { enum: ['all', 'category', 'supplier', 'product'] }).notNull().default('all'),
  scopeValue: text('scope_value'),
  /** Tramo de coste (unidades menores) en el que aplica. */
  minCost: integer('min_cost'),
  maxCost: integer('max_cost'),
  /** Margen sobre el coste en puntos básicos: 15000 = +150 % (precio = coste × 2,5). */
  markupBps: integer('markup_bps').notNull().default(0),
  /** Importe fijo añadido tras el margen (p. ej. para cubrir comisiones). */
  fixedAdd: integer('fixed_add').notNull().default(0),
  rounding: text('rounding', { enum: ['none', '.99', '.95', '.90', '.00'] }).notNull().default('.99'),
  /** Margen mínimo aceptable (bps sobre el precio): por debajo, alerta. */
  minMarginBps: integer('min_margin_bps').notNull().default(1000),
  priority: integer('priority').notNull().default(0),
  active: boolean('active').notNull().default(true),
  ...timestamps,
});

/** Historial de precios por variante (necesario para anunciar rebajas en la UE: precio más bajo de 30 días). */
export const priceHistory = pgTable(
  'price_history',
  {
    id: primaryId('prh'),
    variantId: text('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true, mode: 'date' }).notNull(),
    validTo: timestamp('valid_to', { withTimezone: true, mode: 'date' }),
  },
  (t) => [index('price_history_variant_idx').on(t.variantId, t.validFrom)],
);

export type PriceRule = typeof priceRules.$inferSelect;
