-- CreateTable
CREATE TABLE "InstructorNote" (
    "id" TEXT NOT NULL,
    "flightId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstructorNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstructorNote_flightId_idx" ON "InstructorNote"("flightId");

-- CreateIndex
CREATE INDEX "InstructorNote_instructorId_idx" ON "InstructorNote"("instructorId");

-- CreateIndex
CREATE UNIQUE INDEX "InstructorNote_flightId_instructorId_key" ON "InstructorNote"("flightId", "instructorId");

-- AddForeignKey
ALTER TABLE "InstructorNote" ADD CONSTRAINT "InstructorNote_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "Flight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorNote" ADD CONSTRAINT "InstructorNote_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
