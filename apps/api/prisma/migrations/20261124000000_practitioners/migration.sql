-- S3 Nakes: practitioner registration source and status reason, credential identity hash, affiliation notes.

-- AlterTable
ALTER TABLE "practitioners" ADD COLUMN "statusReason" TEXT,
ADD COLUMN "registeredVia" TEXT NOT NULL DEFAULT 'ADMIN',
ADD COLUMN "createdById" UUID,
ADD COLUMN "createdByFacilityId" UUID;

-- AlterTable: no practitioner could be created before this slice, so the table is empty and the hash can be NOT NULL.
ALTER TABLE "practitioner_credentials" ADD COLUMN "numberHash" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "practitioner_affiliations" ADD COLUMN "note" TEXT,
ADD COLUMN "reason" TEXT,
ADD COLUMN "endedById" UUID;

-- CreateIndex: one practitioner per credential number and type.
CREATE UNIQUE INDEX "practitioner_credentials_credentialType_numberHash_key" ON "practitioner_credentials"("credentialType", "numberHash");

-- Registration source is either the platform or a clinic.
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_registered_via_check" CHECK ("registeredVia" IN ('ADMIN', 'CLINIC'));
