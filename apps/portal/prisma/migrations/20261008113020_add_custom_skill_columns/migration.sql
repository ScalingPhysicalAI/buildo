-- AlterTable
ALTER TABLE "SkillDefinition" ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "isCustom" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "SkillDefinition_createdByUserId_idx" ON "SkillDefinition"("createdByUserId");

-- AddForeignKey
ALTER TABLE "SkillDefinition" ADD CONSTRAINT "SkillDefinition_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
