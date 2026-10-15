-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'SKILL_SUBSCRIPTION';

-- AlterTable
ALTER TABLE "AppListing" ADD COLUMN     "monthlySubscriptionPriceUsd" INTEGER NOT NULL DEFAULT 20;

-- CreateTable
CREATE TABLE "SkillSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "monthlyPriceUsd" INTEGER NOT NULL,
    "subscribedUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SkillSubscription_appId_idx" ON "SkillSubscription"("appId");

-- CreateIndex
CREATE UNIQUE INDEX "SkillSubscription_userId_appId_key" ON "SkillSubscription"("userId", "appId");

-- AddForeignKey
ALTER TABLE "SkillSubscription" ADD CONSTRAINT "SkillSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillSubscription" ADD CONSTRAINT "SkillSubscription_appId_fkey" FOREIGN KEY ("appId") REFERENCES "AppListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
