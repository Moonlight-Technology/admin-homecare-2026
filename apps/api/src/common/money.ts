import { Prisma } from '@prisma/client';

/** Monetary amounts are Decimal(14,2) in IDR; never floats (spec §7). */
export const CURRENCY = 'IDR';

export const toMoney = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toDecimalPlaces(2);

export const sumMoney = (values: Prisma.Decimal.Value[]) =>
  values.reduce<Prisma.Decimal>((total, value) => total.plus(value), new Prisma.Decimal(0)).toDecimalPlaces(2);
