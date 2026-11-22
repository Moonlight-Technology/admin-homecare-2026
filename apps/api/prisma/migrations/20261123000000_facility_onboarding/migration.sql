-- S2 facility onboarding. facility_applications is empty before S2, so profileSnapshot can be NOT NULL without a default.

-- CreateEnum
CREATE TYPE "AccountTokenPurpose" AS ENUM ('PASSWORD_RESET', 'INVITATION');

-- AlterTable
ALTER TABLE "password_reset_tokens" ADD COLUMN     "purpose" "AccountTokenPurpose" NOT NULL DEFAULT 'PASSWORD_RESET';

-- AlterTable
ALTER TABLE "facilities" ADD COLUMN     "registeredVia" TEXT NOT NULL DEFAULT 'SELF',
ADD COLUMN     "statusReason" TEXT;

-- AlterTable
ALTER TABLE "facility_applications" ADD COLUMN     "decidedAt" TIMESTAMPTZ(3),
ADD COLUMN     "documentIds" UUID[],
ADD COLUMN     "profileSnapshot" JSONB NOT NULL;

