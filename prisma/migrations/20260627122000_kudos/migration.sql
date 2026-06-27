-- CreateTable
CREATE TABLE "Kudo" (
    "flightId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Kudo_pkey" PRIMARY KEY ("flightId","profileId")
);

-- CreateIndex
CREATE INDEX "Kudo_flightId_createdAt_idx" ON "Kudo"("flightId", "createdAt");

-- AddForeignKey
ALTER TABLE "Kudo" ADD CONSTRAINT "Kudo_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "Flight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kudo" ADD CONSTRAINT "Kudo_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
