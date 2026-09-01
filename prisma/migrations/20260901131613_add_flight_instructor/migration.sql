-- AlterTable
ALTER TABLE "Flight" ADD COLUMN     "instructorId" TEXT;

-- CreateIndex
CREATE INDEX "Flight_instructorId_idx" ON "Flight"("instructorId");

-- AddForeignKey
ALTER TABLE "Flight" ADD CONSTRAINT "Flight_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
