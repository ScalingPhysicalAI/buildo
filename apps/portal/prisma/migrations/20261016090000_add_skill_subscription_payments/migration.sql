-- CreateTable
CREATE TABLE "SkillSubscriptionPayment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "amountUsd" INTEGER NOT NULL,
    "months" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillSubscriptionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SkillSubscriptionPayment_appId_createdAt_idx" ON "SkillSubscriptionPayment"("appId", "createdAt");

-- AddForeignKey
ALTER TABLE "SkillSubscriptionPayment" ADD CONSTRAINT "SkillSubscriptionPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillSubscriptionPayment" ADD CONSTRAINT "SkillSubscriptionPayment_appId_fkey" FOREIGN KEY ("appId") REFERENCES "AppListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
