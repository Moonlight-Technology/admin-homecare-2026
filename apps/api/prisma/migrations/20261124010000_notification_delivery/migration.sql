-- Additive only. No messages are sent and no existing rows are deleted.
ALTER TABLE "notification_outbox" ADD COLUMN "materializedAt" TIMESTAMPTZ(3), ADD COLUMN "skipReason" TEXT;
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'ACCEPTED', 'FAILED', 'BLOCKED', 'SKIPPED', 'UNKNOWN');
CREATE TABLE "notification_deliveries" (
  "id" UUID NOT NULL, "outboxId" UUID NOT NULL, "channel" TEXT NOT NULL DEFAULT 'EMAIL',
  "recipientKey" TEXT NOT NULL, "recipientEncrypted" TEXT, "templateVersion" TEXT NOT NULL DEFAULT 'v1',
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "leaseToken" UUID, "leaseUntil" TIMESTAMPTZ(3),
  "submittedAt" TIMESTAMPTZ(3), "providerMessageId" TEXT, "acceptedAt" TIMESTAMPTZ(3), "lastErrorCode" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_deliveries_outboxId_fkey" FOREIGN KEY ("outboxId") REFERENCES "notification_outbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "notification_deliveries_outboxId_channel_recipientKey_key" ON "notification_deliveries"("outboxId", "channel", "recipientKey");
CREATE INDEX "notification_deliveries_status_availableAt_idx" ON "notification_deliveries"("status", "availableAt");
CREATE TABLE "notification_controls" (
  "key" TEXT NOT NULL PRIMARY KEY, "count" INTEGER NOT NULL DEFAULT 0, "pausedUntil" TIMESTAMPTZ(3), "reason" TEXT, "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "notification_simulations" (
  "outboxId" UUID NOT NULL PRIMARY KEY, "outcome" TEXT NOT NULL, "recipientCount" INTEGER NOT NULL, "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
