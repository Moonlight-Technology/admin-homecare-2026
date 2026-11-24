-- Additive only: clinic profile media (logo + photos). No existing rows are changed or deleted.

-- CreateEnum
CREATE TYPE "FacilityMediaKind" AS ENUM ('LOGO', 'PHOTO');

-- AlterEnum (the new value is not used inside this migration)
ALTER TYPE "DocumentOwnerType" ADD VALUE 'FACILITY_MEDIA';

-- CreateTable
CREATE TABLE "facility_media" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "kind" "FacilityMediaKind" NOT NULL,
    "caption" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "facility_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "facility_media_documentId_key" ON "facility_media"("documentId");

-- CreateIndex
CREATE INDEX "facility_media_facilityId_kind_sortOrder_idx" ON "facility_media"("facilityId", "kind", "sortOrder");

-- At most one logo per facility (Prisma cannot express partial unique indexes).
CREATE UNIQUE INDEX "facility_media_one_logo_key" ON "facility_media"("facilityId") WHERE "kind" = 'LOGO';

ALTER TABLE "facility_media" ADD CONSTRAINT "facility_media_sort_order_check" CHECK ("sortOrder" >= 0);

-- AddForeignKey
ALTER TABLE "facility_media" ADD CONSTRAINT "facility_media_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_media" ADD CONSTRAINT "facility_media_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
