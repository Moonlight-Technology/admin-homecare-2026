import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Interactive transactions default to 5 s, which a multi-step approval (status, capacity, history, audit, outbox)
 * can exceed when every round trip crosses regions. Prisma then aborts it mid-way with "Transaction not found".
 * These limits keep a slow network from failing correct work while still bounding a stuck transaction.
 */
export const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ transactionOptions: TRANSACTION_OPTIONS });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

/** A Prisma client or an interactive transaction client, so helpers can join the caller's transaction. */
export type Db = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;
