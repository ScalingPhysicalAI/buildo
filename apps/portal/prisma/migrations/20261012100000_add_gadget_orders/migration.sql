-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'GADGET_PURCHASE';

-- CreateTable
CREATE TABLE "GadgetOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "phone" TEXT,
    "shippingAddress" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GadgetOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GadgetOrder_userId_idx" ON "GadgetOrder"("userId");

-- AddForeignKey
ALTER TABLE "GadgetOrder" ADD CONSTRAINT "GadgetOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
