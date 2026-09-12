-- CreateTable
CREATE TABLE "RatingSignoff" (
    "id" TEXT NOT NULL,
    "flightId" TEXT NOT NULL,
    "pilotId" TEXT NOT NULL,
    "ratingLevel" TEXT NOT NULL,
    "criterionKey" TEXT NOT NULL,
    "signedByProfileId" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "RatingSignoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RatingSignoff_pilotId_ratingLevel_criterionKey_idx" ON "RatingSignoff"("pilotId", "ratingLevel", "criterionKey");

-- CreateIndex
CREATE INDEX "RatingSignoff_flightId_idx" ON "RatingSignoff"("flightId");

-- CreateIndex
CREATE INDEX "RatingSignoff_signedByProfileId_idx" ON "RatingSignoff"("signedByProfileId");

-- AddForeignKey
ALTER TABLE "RatingSignoff" ADD CONSTRAINT "RatingSignoff_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "Flight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatingSignoff" ADD CONSTRAINT "RatingSignoff_pilotId_fkey" FOREIGN KEY ("pilotId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RatingSignoff" ADD CONSTRAINT "RatingSignoff_signedByProfileId_fkey" FOREIGN KEY ("signedByProfileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
