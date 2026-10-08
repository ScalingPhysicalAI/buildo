-- CreateEnum
CREATE TYPE "CollectionStatus" AS ENUM ('UPLOADED', 'TRAINING', 'TRAINED', 'FAILED');

-- CreateEnum
CREATE TYPE "AppCategory" AS ENUM ('HOME', 'GENERAL', 'PUBLIC', 'KITCHEN', 'CLEANING', 'INVENTORY');

-- CreateEnum
CREATE TYPE "AppDeployStatus" AS ENUM ('DRAFT', 'TESTING', 'PASSED', 'FAILED', 'LIVE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionType" ADD VALUE 'SKILL_COLLECTION_REWARD';
ALTER TYPE "TransactionType" ADD VALUE 'APP_DEPLOY_FEE';
ALTER TYPE "TransactionType" ADD VALUE 'APP_EARNINGS';

-- CreateTable
CREATE TABLE "SkillDefinition" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "reward" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillCollectionSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "status" "CollectionStatus" NOT NULL DEFAULT 'UPLOADED',
    "fileName" TEXT,
    "durationSec" INTEGER,
    "rewardPaid" BOOLEAN NOT NULL DEFAULT false,
    "trainStartedAt" TIMESTAMP(3),
    "trainEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillCollectionSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppListing" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "AppCategory" NOT NULL,
    "iconUrl" TEXT,
    "videoUrl" TEXT,
    "status" "AppDeployStatus" NOT NULL DEFAULT 'DRAFT',
    "testReport" JSONB,
    "publishedAt" TIMESTAMP(3),
    "earnings" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppInstall" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppInstall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppListingSkill" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "skillCollectionId" TEXT NOT NULL,

    CONSTRAINT "AppListingSkill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SkillDefinition_slug_key" ON "SkillDefinition"("slug");

-- CreateIndex
CREATE INDEX "SkillCollectionSession_userId_idx" ON "SkillCollectionSession"("userId");

-- CreateIndex
CREATE INDEX "SkillCollectionSession_skillId_idx" ON "SkillCollectionSession"("skillId");

-- CreateIndex
CREATE INDEX "AppListing_userId_idx" ON "AppListing"("userId");

-- CreateIndex
CREATE INDEX "AppInstall_appId_idx" ON "AppInstall"("appId");

-- CreateIndex
CREATE UNIQUE INDEX "AppInstall_appId_userId_key" ON "AppInstall"("appId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AppListingSkill_appId_skillCollectionId_key" ON "AppListingSkill"("appId", "skillCollectionId");

-- AddForeignKey
ALTER TABLE "SkillCollectionSession" ADD CONSTRAINT "SkillCollectionSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillCollectionSession" ADD CONSTRAINT "SkillCollectionSession_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "SkillDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppListing" ADD CONSTRAINT "AppListing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppInstall" ADD CONSTRAINT "AppInstall_appId_fkey" FOREIGN KEY ("appId") REFERENCES "AppListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppListingSkill" ADD CONSTRAINT "AppListingSkill_appId_fkey" FOREIGN KEY ("appId") REFERENCES "AppListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppListingSkill" ADD CONSTRAINT "AppListingSkill_skillCollectionId_fkey" FOREIGN KEY ("skillCollectionId") REFERENCES "SkillCollectionSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
