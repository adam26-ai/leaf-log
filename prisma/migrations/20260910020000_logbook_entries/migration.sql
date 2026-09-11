ALTER TABLE "Flight" ALTER COLUMN "igcSha256" DROP NOT NULL;
ALTER TABLE "Flight"
  ADD COLUMN "recordingKind" TEXT NOT NULL DEFAULT 'igc',
  ADD COLUMN "reportedXcDistanceM" INTEGER,
  ADD COLUMN "reportedXcType" TEXT,
  ADD COLUMN "logbookImportId" TEXT,
  ADD COLUMN "importRow" INTEGER,
  ADD COLUMN "entryRequestId" TEXT;

CREATE TABLE "LogbookImport" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "fileHash" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "importedCount" INTEGER NOT NULL,
  "skippedCount" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "undoneAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LogbookImport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LogbookImport_ownerId_requestId_key" ON "LogbookImport"("ownerId", "requestId");
CREATE INDEX "LogbookImport_ownerId_fileHash_idx" ON "LogbookImport"("ownerId", "fileHash");
CREATE UNIQUE INDEX "Flight_ownerId_entryRequestId_key" ON "Flight"("ownerId", "entryRequestId");
CREATE UNIQUE INDEX "Flight_logbookImportId_importRow_key" ON "Flight"("logbookImportId", "importRow");
ALTER TABLE "LogbookImport" ADD CONSTRAINT "LogbookImport_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Flight" ADD CONSTRAINT "Flight_logbookImportId_fkey" FOREIGN KEY ("logbookImportId") REFERENCES "LogbookImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
