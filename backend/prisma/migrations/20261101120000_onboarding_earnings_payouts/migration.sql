-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('TEACHER_DOCUMENT', 'AVATAR');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('DEGREE', 'CERTIFICATE', 'ID_PROOF', 'EXPERIENCE', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentReviewStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EarningType" AS ENUM ('SESSION', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('ALL', 'STUDENT', 'TEACHER');

-- AlterTable
ALTER TABLE "TeacherProfile" ADD COLUMN     "applicationSubmittedAt" TIMESTAMPTZ(3),
ADD COLUMN     "rejectionReason" TEXT;

-- CreateTable
CREATE TABLE "TeacherInvitation" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT,
    "invitedById" UUID,
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "lastSentAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDeliveryError" TEXT,
    "deliveredAt" TIMESTAMPTZ(3),
    "acceptedAt" TIMESTAMPTZ(3),
    "acceptedUserId" UUID,
    "revokedAt" TIMESTAMPTZ(3),
    "revokedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TeacherInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "kind" "FileKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherDocument" (
    "id" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "type" "DocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "reviewStatus" "DocumentReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherEarning" (
    "id" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "bookingId" UUID,
    "type" "EarningType" NOT NULL DEFAULT 'SESSION',
    "amountMinor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "description" TEXT NOT NULL,
    "payoutId" UUID,
    "earnedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherEarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherPayout" (
    "id" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "status" "PayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMPTZ(3),
    "decidedById" UUID,
    "paidAt" TIMESTAMPTZ(3),
    "reference" TEXT,
    "note" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TeacherPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" "AnnouncementAudience" NOT NULL DEFAULT 'ALL',
    "startsAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMPTZ(3),
    "archivedAt" TIMESTAMPTZ(3),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeacherInvitation_tokenHash_key" ON "TeacherInvitation"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherInvitation_acceptedUserId_key" ON "TeacherInvitation"("acceptedUserId");

-- CreateIndex
CREATE INDEX "TeacherInvitation_status_createdAt_idx" ON "TeacherInvitation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TeacherInvitation_email_idx" ON "TeacherInvitation"("email");

-- CreateIndex
CREATE INDEX "StoredFile_ownerId_kind_idx" ON "StoredFile"("ownerId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherDocument_fileId_key" ON "TeacherDocument"("fileId");

-- CreateIndex
CREATE INDEX "TeacherDocument_teacherId_createdAt_idx" ON "TeacherDocument"("teacherId", "createdAt");

-- CreateIndex
CREATE INDEX "TeacherEarning_teacherId_earnedAt_idx" ON "TeacherEarning"("teacherId", "earnedAt");

-- CreateIndex
CREATE INDEX "TeacherEarning_teacherId_payoutId_idx" ON "TeacherEarning"("teacherId", "payoutId");

-- CreateIndex
CREATE INDEX "TeacherEarning_payoutId_idx" ON "TeacherEarning"("payoutId");

-- CreateIndex
CREATE INDEX "TeacherPayout_status_requestedAt_idx" ON "TeacherPayout"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "TeacherPayout_teacherId_requestedAt_idx" ON "TeacherPayout"("teacherId", "requestedAt");

-- CreateIndex
CREATE INDEX "Announcement_archivedAt_startsAt_idx" ON "Announcement"("archivedAt", "startsAt");

-- CreateIndex
CREATE INDEX "TeacherProfile_approvalStatus_applicationSubmittedAt_idx" ON "TeacherProfile"("approvalStatus", "applicationSubmittedAt");

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherDocument" ADD CONSTRAINT "TeacherDocument_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "TeacherProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherDocument" ADD CONSTRAINT "TeacherDocument_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoredFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherEarning" ADD CONSTRAINT "TeacherEarning_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "TeacherProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherEarning" ADD CONSTRAINT "TeacherEarning_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherEarning" ADD CONSTRAINT "TeacherEarning_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "TeacherPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherPayout" ADD CONSTRAINT "TeacherPayout_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "TeacherProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------------
-- Hand-written integrity rules (Prisma cannot express these). See docs/database.md.
-- ---------------------------------------------------------------------------------------------

-- Invitations: one live invitation per email (case-insensitive); tokens are stored hashed only.
CREATE UNIQUE INDEX "teacher_invitation_one_pending_per_email"
  ON "TeacherInvitation" (lower("email")) WHERE "status" = 'PENDING';
ALTER TABLE "TeacherInvitation" ADD CONSTRAINT "teacher_invitation_send_count" CHECK ("sendCount" BETWEEN 1 AND 20);

-- Files: bounded sizes, recorded size matches the stored bytes.
ALTER TABLE "StoredFile" ADD CONSTRAINT "stored_file_size" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 10485760 AND "sizeBytes" = octet_length("data"));

-- Earnings: one SESSION entry per booking; SESSION entries are positive and tied to a booking.
CREATE UNIQUE INDEX "teacher_earning_one_session_per_booking"
  ON "TeacherEarning" ("bookingId") WHERE "type" = 'SESSION';
ALTER TABLE "TeacherEarning" ADD CONSTRAINT "teacher_earning_session_shape"
  CHECK ("type" <> 'SESSION' OR ("bookingId" IS NOT NULL AND "amountMinor" > 0));
ALTER TABLE "TeacherEarning" ADD CONSTRAINT "teacher_earning_nonzero" CHECK ("amountMinor" <> 0);

-- Earnings are append-only: only the payout allocation may change after insert, and rows are never deleted.
CREATE OR REPLACE FUNCTION teacher_earning_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'TeacherEarning rows are append-only' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."teacherId" IS DISTINCT FROM OLD."teacherId"
     OR NEW."bookingId" IS DISTINCT FROM OLD."bookingId"
     OR NEW."type" IS DISTINCT FROM OLD."type"
     OR NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."earnedAt" IS DISTINCT FROM OLD."earnedAt" THEN
    RAISE EXCEPTION 'TeacherEarning amounts are immutable; record an ADJUSTMENT instead' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER teacher_earning_immutable
  BEFORE UPDATE OR DELETE ON "TeacherEarning"
  FOR EACH ROW EXECUTE FUNCTION teacher_earning_immutable();

-- Payouts: positive amounts, at most one open payout per teacher, paid payouts carry a reference.
ALTER TABLE "TeacherPayout" ADD CONSTRAINT "teacher_payout_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "TeacherPayout" ADD CONSTRAINT "teacher_payout_paid_reference"
  CHECK ("status" <> 'PAID' OR ("reference" IS NOT NULL AND "paidAt" IS NOT NULL));
CREATE UNIQUE INDEX "teacher_payout_one_open_per_teacher"
  ON "TeacherPayout" ("teacherId") WHERE "status" IN ('REQUESTED', 'APPROVED');

ALTER TABLE "Announcement" ADD CONSTRAINT "announcement_window" CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt");

-- Backfill: completed bookings that were paid earn the teacher their session price, reduced
-- pro rata by any refund (same rule as utils/money.ts#teacherEarningMinor). Unpaid bookings earn nothing.
INSERT INTO "TeacherEarning" ("id", "teacherId", "bookingId", "type", "amountMinor", "currency", "description", "earnedAt", "createdAt")
SELECT gen_random_uuid(), b."teacherId", b.id, 'SESSION',
       CASE WHEN paid.net >= b."totalMinor" THEN b."priceMinor"
            ELSE (b."priceMinor"::bigint * paid.net / b."totalMinor")::int END,
       b.currency, 'Session completed (backfill)', COALESCE(b."completedAt", b."endAt"), now()
  FROM "Booking" b
  JOIN LATERAL (
        SELECT COALESCE(SUM(p."amountMinor" - p."refundedMinor"), 0)::bigint AS net
          FROM "Payment" p
         WHERE p."bookingId" = b.id AND p.status IN ('CAPTURED', 'PARTIALLY_REFUNDED')
       ) paid ON true
 WHERE b.status = 'COMPLETED' AND paid.net > 0 AND b."totalMinor" > 0
   AND (CASE WHEN paid.net >= b."totalMinor" THEN b."priceMinor"
             ELSE (b."priceMinor"::bigint * paid.net / b."totalMinor")::int END) > 0;

-- Existing PENDING teachers predate explicit submission; they must submit before approval.
-- Already-approved teachers are treated as having submitted when they were approved.
UPDATE "TeacherProfile" SET "applicationSubmittedAt" = COALESCE("approvedAt", "createdAt")
 WHERE "approvalStatus" IN ('APPROVED', 'SUSPENDED') AND "applicationSubmittedAt" IS NULL;
