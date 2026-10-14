-- CreateEnum
CREATE TYPE "WalletKind" AS ENUM ('CREATOR', 'OWNER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "ownerWalletBalance" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "TokenTransaction" ADD COLUMN     "wallet" "WalletKind" NOT NULL DEFAULT 'CREATOR';

-- DataMigration: the owner wallet used to be the same column as the
-- creator's tokenBalance (WALLET_TOPUP briefly credited it there before this
-- migration). Move any such existing top-up amounts out of tokenBalance and
-- into the new, separate ownerWalletBalance, and retag their ledger rows.
-- A no-op if no owner-app top-up has happened yet.
UPDATE "TokenTransaction" SET "wallet" = 'OWNER' WHERE "type" = 'WALLET_TOPUP';

UPDATE "User" u
SET "tokenBalance" = u."tokenBalance" - moved.total,
    "ownerWalletBalance" = u."ownerWalletBalance" + moved.total
FROM (
  SELECT "userId", SUM("amount") AS total
  FROM "TokenTransaction"
  WHERE "type" = 'WALLET_TOPUP'
  GROUP BY "userId"
) AS moved
WHERE u.id = moved."userId";
