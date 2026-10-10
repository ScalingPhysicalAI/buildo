-- AppCategory is narrowed from the old free-form set (HOME, GENERAL, PUBLIC,
-- KITCHEN, CLEANING, INVENTORY) to the 5 "robot app" use cases shown in the
-- mobile Train tab (HOME, SHOP, OFFICE, WAREHOUSE, HOSPITAL). Postgres can't
-- drop enum values in place, so the type is recreated and any existing rows
-- are remapped to the closest new value.
ALTER TYPE "AppCategory" RENAME TO "AppCategory_old";
CREATE TYPE "AppCategory" AS ENUM ('HOME', 'SHOP', 'OFFICE', 'WAREHOUSE', 'HOSPITAL');

ALTER TABLE "AppListing" ALTER COLUMN "category" TYPE "AppCategory" USING (
  (CASE "category"::text
    WHEN 'HOME' THEN 'HOME'
    WHEN 'KITCHEN' THEN 'HOME'
    WHEN 'CLEANING' THEN 'HOME'
    WHEN 'GENERAL' THEN 'SHOP'
    WHEN 'PUBLIC' THEN 'HOSPITAL'
    WHEN 'INVENTORY' THEN 'WAREHOUSE'
    ELSE 'HOME'
  END)::"AppCategory"
);

DROP TYPE "AppCategory_old";
