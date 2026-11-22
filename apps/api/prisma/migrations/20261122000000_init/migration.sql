-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "MembershipScope" AS ENUM ('PLATFORM', 'FACILITY');

-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('FACILITY', 'INDEPENDENT_PRACTITIONER');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REVISION_REQUIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OperatingStatus" AS ENUM ('INACTIVE', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REVISION_REQUIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('APPROVE', 'REJECT', 'REQUEST_REVISION');

-- CreateEnum
CREATE TYPE "ReviewTargetType" AS ENUM ('FACILITY_APPLICATION', 'PRACTITIONER');

-- CreateEnum
CREATE TYPE "DocumentOwnerType" AS ENUM ('FACILITY', 'PRACTITIONER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING_UPLOAD', 'UPLOADED', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AffiliationStatus" AS ENUM ('PROPOSED', 'ACTIVE', 'REJECTED', 'ENDED');

-- CreateEnum
CREATE TYPE "FulfillmentMode" AS ENUM ('ON_SITE', 'HOMECARE');

-- CreateEnum
CREATE TYPE "OfferingStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_APPROVAL', 'CONFIRMED', 'REJECTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('NOT_CONFIGURED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('UNASSIGNED', 'PARTIALLY_ASSIGNED', 'ASSIGNED');

-- CreateEnum
CREATE TYPE "OrderItemStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'NOT_PERFORMED');

-- CreateEnum
CREATE TYPE "OrderAssignmentState" AS ENUM ('ACTIVE', 'UNASSIGNED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "replacedBy" UUID,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "MembershipScope" NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "scope" "MembershipScope" NOT NULL,
    "description" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "scopeType" "MembershipScope" NOT NULL,
    "facilityId" UUID,
    "roleId" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facility_types" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "facility_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_classes" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "clinic_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capabilities" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practitioner_types" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "practitioner_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_services" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "master_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_requirements" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "ownerType" "DocumentOwnerType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "document_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regions" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "parentCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "providers" (
    "id" UUID NOT NULL,
    "type" "ProviderType" NOT NULL,
    "facilityId" UUID,
    "practitionerId" UUID,
    "status" "OperatingStatus" NOT NULL DEFAULT 'INACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facilities" (
    "id" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "facilityTypeId" UUID NOT NULL,
    "clinicClassId" UUID,
    "phone" TEXT,
    "email" TEXT,
    "addressLine" TEXT NOT NULL,
    "regionCode" TEXT,
    "postalCode" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'DRAFT',
    "operatingStatus" "OperatingStatus" NOT NULL DEFAULT 'INACTIVE',
    "verifiedAt" TIMESTAMPTZ(3),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "facilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facility_capabilities" (
    "facilityId" UUID NOT NULL,
    "capabilityId" UUID NOT NULL,

    CONSTRAINT "facility_capabilities_pkey" PRIMARY KEY ("facilityId","capabilityId")
);

-- CreateTable
CREATE TABLE "facility_applications" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "facility_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "ownerType" "DocumentOwnerType" NOT NULL,
    "ownerId" UUID NOT NULL,
    "requirementId" UUID,
    "objectKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "uploadedById" UUID,
    "uploadedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_reviews" (
    "id" UUID NOT NULL,
    "targetType" "ReviewTargetType" NOT NULL,
    "targetId" UUID NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "reason" TEXT,
    "reviewerId" UUID NOT NULL,
    "documentIds" UUID[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practitioners" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "fullName" TEXT NOT NULL,
    "practitionerTypeId" UUID NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'DRAFT',
    "operatingStatus" "OperatingStatus" NOT NULL DEFAULT 'INACTIVE',
    "verifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "practitioners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practitioner_credentials" (
    "id" UUID NOT NULL,
    "practitionerId" UUID NOT NULL,
    "credentialType" TEXT NOT NULL,
    "numberEncrypted" TEXT NOT NULL,
    "numberMasked" TEXT NOT NULL,
    "issuingAuthority" TEXT,
    "validFrom" DATE,
    "validUntil" DATE,
    "documentId" UUID,
    "reviewStatus" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "practitioner_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practitioner_affiliations" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "practitionerId" UUID NOT NULL,
    "status" "AffiliationStatus" NOT NULL DEFAULT 'PROPOSED',
    "startDate" DATE,
    "endDate" DATE,
    "proposedById" UUID,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "practitioner_affiliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_offerings" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "masterServiceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "preparationNote" TEXT,
    "terms" TEXT,
    "basePrice" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "durationMinutes" INTEGER NOT NULL,
    "status" "OfferingStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_offerings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offering_modes" (
    "id" UUID NOT NULL,
    "offeringId" UUID NOT NULL,
    "mode" "FulfillmentMode" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priceOverride" DECIMAL(14,2),
    "visitFee" DECIMAL(14,2),
    "serviceAreaRule" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "offering_modes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facility_schedules" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "mode" "FulfillmentMode" NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "slotMinutes" INTEGER NOT NULL,
    "capacityPerSlot" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "facility_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facility_slots" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "mode" "FulfillmentMode" NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "facility_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_blocks" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "mode" "FulfillmentMode",
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "facilityId" UUID,
    "slotId" UUID,
    "mode" "FulfillmentMode" NOT NULL,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    "patientSnapshot" JSONB NOT NULL,
    "facilitySnapshot" JSONB,
    "addressSnapshot" JSONB,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "itemSubtotal" DECIMAL(14,2) NOT NULL,
    "feeTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(14,2) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "assignmentStatus" "AssignmentStatus" NOT NULL DEFAULT 'UNASSIGNED',
    "rejectionReason" TEXT,
    "idempotencyKey" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "offeringId" UUID NOT NULL,
    "masterServiceId" UUID NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "priceSnapshot" DECIMAL(14,2) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "modeSnapshot" "FulfillmentMode" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" "OrderItemStatus" NOT NULL DEFAULT 'PENDING',
    "notPerformedReason" TEXT,
    "performedMeta" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_assignments" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "orderItemId" UUID,
    "practitionerId" UUID NOT NULL,
    "state" "OrderAssignmentState" NOT NULL DEFAULT 'ACTIVE',
    "assignedById" UUID NOT NULL,
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMPTZ(3),

    CONSTRAINT "order_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "previousStatus" "OrderStatus",
    "newStatus" "OrderStatus" NOT NULL,
    "actorId" UUID,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_status_history" (
    "id" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "previousStatus" "OrderItemStatus",
    "newStatus" "OrderItemStatus" NOT NULL,
    "actorId" UUID,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_item_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "scope" TEXT NOT NULL,
    "facilityId" UUID,
    "event" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "recipient" TEXT,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "memberships_userId_idx" ON "memberships"("userId");

-- CreateIndex
CREATE INDEX "memberships_facilityId_idx" ON "memberships"("facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "facility_types_code_key" ON "facility_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_classes_code_key" ON "clinic_classes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "capabilities_code_key" ON "capabilities"("code");

-- CreateIndex
CREATE UNIQUE INDEX "practitioner_types_code_key" ON "practitioner_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_slug_key" ON "service_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "master_services_code_key" ON "master_services"("code");

-- CreateIndex
CREATE INDEX "master_services_categoryId_idx" ON "master_services"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "document_requirements_code_key" ON "document_requirements"("code");

-- CreateIndex
CREATE INDEX "regions_parentCode_idx" ON "regions"("parentCode");

-- CreateIndex
CREATE INDEX "regions_level_idx" ON "regions"("level");

-- CreateIndex
CREATE UNIQUE INDEX "providers_facilityId_key" ON "providers"("facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "providers_practitionerId_key" ON "providers"("practitionerId");

-- CreateIndex
CREATE INDEX "facilities_verificationStatus_idx" ON "facilities"("verificationStatus");

-- CreateIndex
CREATE INDEX "facilities_operatingStatus_idx" ON "facilities"("operatingStatus");

-- CreateIndex
CREATE INDEX "facilities_facilityTypeId_idx" ON "facilities"("facilityTypeId");

-- CreateIndex
CREATE INDEX "facility_applications_status_idx" ON "facility_applications"("status");

-- CreateIndex
CREATE UNIQUE INDEX "facility_applications_facilityId_version_key" ON "facility_applications"("facilityId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "documents_objectKey_key" ON "documents"("objectKey");

-- CreateIndex
CREATE INDEX "documents_ownerType_ownerId_idx" ON "documents"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "verification_reviews_targetType_targetId_idx" ON "verification_reviews"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "practitioners_userId_key" ON "practitioners"("userId");

-- CreateIndex
CREATE INDEX "practitioners_verificationStatus_idx" ON "practitioners"("verificationStatus");

-- CreateIndex
CREATE INDEX "practitioners_operatingStatus_idx" ON "practitioners"("operatingStatus");

-- CreateIndex
CREATE INDEX "practitioner_credentials_practitionerId_idx" ON "practitioner_credentials"("practitionerId");

-- CreateIndex
CREATE INDEX "practitioner_affiliations_facilityId_status_idx" ON "practitioner_affiliations"("facilityId", "status");

-- CreateIndex
CREATE INDEX "practitioner_affiliations_practitionerId_status_idx" ON "practitioner_affiliations"("practitionerId", "status");

-- CreateIndex
CREATE INDEX "service_offerings_providerId_status_idx" ON "service_offerings"("providerId", "status");

-- CreateIndex
CREATE INDEX "service_offerings_masterServiceId_idx" ON "service_offerings"("masterServiceId");

-- CreateIndex
CREATE UNIQUE INDEX "offering_modes_offeringId_mode_key" ON "offering_modes"("offeringId", "mode");

-- CreateIndex
CREATE INDEX "facility_schedules_facilityId_mode_dayOfWeek_idx" ON "facility_schedules"("facilityId", "mode", "dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "facility_slots_facilityId_mode_startsAt_key" ON "facility_slots"("facilityId", "mode", "startsAt");

-- CreateIndex
CREATE INDEX "schedule_blocks_facilityId_startsAt_idx" ON "schedule_blocks"("facilityId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "orders_code_key" ON "orders"("code");

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotencyKey_key" ON "orders"("idempotencyKey");

-- CreateIndex
CREATE INDEX "orders_providerId_status_idx" ON "orders"("providerId", "status");

-- CreateIndex
CREATE INDEX "orders_facilityId_status_idx" ON "orders"("facilityId", "status");

-- CreateIndex
CREATE INDEX "orders_scheduledAt_idx" ON "orders"("scheduledAt");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "order_items_offeringId_idx" ON "order_items"("offeringId");

-- CreateIndex
CREATE INDEX "order_assignments_orderId_idx" ON "order_assignments"("orderId");

-- CreateIndex
CREATE INDEX "order_assignments_practitionerId_state_idx" ON "order_assignments"("practitionerId", "state");

-- CreateIndex
CREATE INDEX "order_status_history_orderId_createdAt_idx" ON "order_status_history"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "order_item_status_history_orderItemId_createdAt_idx" ON "order_item_status_history"("orderItemId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_event_createdAt_idx" ON "audit_logs"("event", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "notification_outbox_status_availableAt_idx" ON "notification_outbox"("status", "availableAt");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_services" ADD CONSTRAINT "master_services_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regions" ADD CONSTRAINT "regions_parentCode_fkey" FOREIGN KEY ("parentCode") REFERENCES "regions"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "providers" ADD CONSTRAINT "providers_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "providers" ADD CONSTRAINT "providers_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "practitioners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_facilityTypeId_fkey" FOREIGN KEY ("facilityTypeId") REFERENCES "facility_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_clinicClassId_fkey" FOREIGN KEY ("clinicClassId") REFERENCES "clinic_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_capabilities" ADD CONSTRAINT "facility_capabilities_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_capabilities" ADD CONSTRAINT "facility_capabilities_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "capabilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_applications" ADD CONSTRAINT "facility_applications_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "document_requirements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_practitionerTypeId_fkey" FOREIGN KEY ("practitionerTypeId") REFERENCES "practitioner_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioner_credentials" ADD CONSTRAINT "practitioner_credentials_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "practitioners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioner_credentials" ADD CONSTRAINT "practitioner_credentials_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioner_affiliations" ADD CONSTRAINT "practitioner_affiliations_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practitioner_affiliations" ADD CONSTRAINT "practitioner_affiliations_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "practitioners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_offerings" ADD CONSTRAINT "service_offerings_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_offerings" ADD CONSTRAINT "service_offerings_masterServiceId_fkey" FOREIGN KEY ("masterServiceId") REFERENCES "master_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offering_modes" ADD CONSTRAINT "offering_modes_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "service_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_schedules" ADD CONSTRAINT "facility_schedules_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_slots" ADD CONSTRAINT "facility_slots_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "facility_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "service_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_masterServiceId_fkey" FOREIGN KEY ("masterServiceId") REFERENCES "master_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_assignments" ADD CONSTRAINT "order_assignments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_assignments" ADD CONSTRAINT "order_assignments_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_assignments" ADD CONSTRAINT "order_assignments_practitionerId_fkey" FOREIGN KEY ("practitionerId") REFERENCES "practitioners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_status_history" ADD CONSTRAINT "order_item_status_history_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Constraints Prisma cannot express (spec §3, §7) ─────────────────────────

-- A provider is owned by exactly one facility or one independent practitioner, matching its type.
ALTER TABLE "providers" ADD CONSTRAINT "providers_exclusive_owner_check" CHECK (
  ("type" = 'FACILITY' AND "facilityId" IS NOT NULL AND "practitionerId" IS NULL)
  OR ("type" = 'INDEPENDENT_PRACTITIONER' AND "practitionerId" IS NOT NULL AND "facilityId" IS NULL)
);

-- Platform memberships have no facility; facility memberships always have one.
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_scope_facility_check" CHECK (
  ("scopeType" = 'PLATFORM' AND "facilityId" IS NULL)
  OR ("scopeType" = 'FACILITY' AND "facilityId" IS NOT NULL)
);

-- One active membership per user, role, and facility (platform memberships share the NULL facility).
CREATE UNIQUE INDEX "memberships_active_unique"
  ON "memberships" ("userId", "roleId", COALESCE("facilityId", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "active" = true;

-- One live affiliation per facility/practitioner pair.
CREATE UNIQUE INDEX "practitioner_affiliations_live_unique"
  ON "practitioner_affiliations" ("facilityId", "practitionerId")
  WHERE "status" IN ('PROPOSED', 'ACTIVE');

-- Money and counts are never negative; a slot never holds more than its capacity.
ALTER TABLE "service_offerings" ADD CONSTRAINT "service_offerings_amounts_check" CHECK ("basePrice" >= 0 AND "durationMinutes" > 0);
ALTER TABLE "offering_modes" ADD CONSTRAINT "offering_modes_amounts_check" CHECK (COALESCE("priceOverride", 0) >= 0 AND COALESCE("visitFee", 0) >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_check" CHECK ("itemSubtotal" >= 0 AND "feeTotal" >= 0 AND "grandTotal" >= 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_amounts_check" CHECK ("priceSnapshot" >= 0 AND "quantity" > 0 AND "durationMinutes" > 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_not_performed_reason_check" CHECK ("status" <> 'NOT_PERFORMED' OR "notPerformedReason" IS NOT NULL);
ALTER TABLE "facility_slots" ADD CONSTRAINT "facility_slots_capacity_check" CHECK ("capacity" >= 0 AND "reserved" >= 0 AND "reserved" <= "capacity");
ALTER TABLE "facility_schedules" ADD CONSTRAINT "facility_schedules_values_check" CHECK ("dayOfWeek" BETWEEN 0 AND 6 AND "slotMinutes" > 0 AND "capacityPerSlot" >= 0);

-- History tables are append-only.
CREATE FUNCTION "reject_history_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'History records are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "order_status_history_append_only" BEFORE UPDATE OR DELETE ON "order_status_history" FOR EACH ROW EXECUTE FUNCTION "reject_history_change"();
CREATE TRIGGER "order_item_status_history_append_only" BEFORE UPDATE OR DELETE ON "order_item_status_history" FOR EACH ROW EXECUTE FUNCTION "reject_history_change"();
CREATE TRIGGER "verification_reviews_append_only" BEFORE UPDATE OR DELETE ON "verification_reviews" FOR EACH ROW EXECUTE FUNCTION "reject_history_change"();
CREATE TRIGGER "audit_logs_append_only" BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION "reject_history_change"();
