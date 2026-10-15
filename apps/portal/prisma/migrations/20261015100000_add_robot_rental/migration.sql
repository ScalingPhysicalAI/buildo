-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'ROBOT_RENT';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "referredById" TEXT,
ADD COLUMN     "rentTermMonths" INTEGER,
ADD COLUMN     "monthlyRentUsd" INTEGER,
ADD COLUMN     "rentStartedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
