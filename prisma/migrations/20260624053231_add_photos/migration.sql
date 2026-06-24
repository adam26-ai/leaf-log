-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "flightId" TEXT NOT NULL,
    "originalFilename" TEXT,
    "contentType" TEXT NOT NULL DEFAULT 'image/jpeg',
    "displayWidth" INTEGER NOT NULL,
    "displayHeight" INTEGER NOT NULL,
    "displayBytes" INTEGER NOT NULL,
    "thumbWidth" INTEGER NOT NULL,
    "thumbHeight" INTEGER NOT NULL,
    "thumbBytes" INTEGER NOT NULL,
    "takenAt" TIMESTAMP(3),
    "tSec" DOUBLE PRECISION,
    "exifOffsetMinutes" INTEGER,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "altM" INTEGER,
    "placementSource" TEXT NOT NULL DEFAULT 'unpinned',
    "placementFailureReason" TEXT,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoData" (
    "photoId" TEXT NOT NULL,
    "display" BYTEA NOT NULL,
    "thumb" BYTEA NOT NULL,

    CONSTRAINT "PhotoData_pkey" PRIMARY KEY ("photoId")
);

-- CreateIndex
CREATE INDEX "Photo_flightId_takenAt_idx" ON "Photo"("flightId", "takenAt");

-- CreateIndex
CREATE UNIQUE INDEX "Photo_flightId_sha256_key" ON "Photo"("flightId", "sha256");

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "Flight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoData" ADD CONSTRAINT "PhotoData_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
