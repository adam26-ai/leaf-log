-- CreateTable
CREATE TABLE "LocationAuditEntry" (
    "id" TEXT NOT NULL,
    "siteId" TEXT,
    "zoneId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationAuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteEndorsement" (
    "siteId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteEndorsement_pkey" PRIMARY KEY ("siteId","profileId")
);

-- CreateTable
CREATE TABLE "ZoneEndorsement" (
    "zoneId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZoneEndorsement_pkey" PRIMARY KEY ("zoneId","profileId")
);

-- CreateIndex
CREATE INDEX "LocationAuditEntry_siteId_createdAt_idx" ON "LocationAuditEntry"("siteId", "createdAt");

-- CreateIndex
CREATE INDEX "LocationAuditEntry_zoneId_createdAt_idx" ON "LocationAuditEntry"("zoneId", "createdAt");

-- CreateIndex
CREATE INDEX "LocationAuditEntry_actorId_idx" ON "LocationAuditEntry"("actorId");

-- CreateIndex
CREATE INDEX "SiteEndorsement_siteId_createdAt_idx" ON "SiteEndorsement"("siteId", "createdAt");

-- CreateIndex
CREATE INDEX "ZoneEndorsement_zoneId_createdAt_idx" ON "ZoneEndorsement"("zoneId", "createdAt");

-- AddForeignKey
ALTER TABLE "LocationAuditEntry" ADD CONSTRAINT "LocationAuditEntry_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationAuditEntry" ADD CONSTRAINT "LocationAuditEntry_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationAuditEntry" ADD CONSTRAINT "LocationAuditEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteEndorsement" ADD CONSTRAINT "SiteEndorsement_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteEndorsement" ADD CONSTRAINT "SiteEndorsement_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneEndorsement" ADD CONSTRAINT "ZoneEndorsement_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneEndorsement" ADD CONSTRAINT "ZoneEndorsement_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma v6 cannot express CHECK constraints declaratively (SPRINT-006
-- precedent: the boundary bbox CHECK). Exactly one of siteId/zoneId must be
-- non-null — the target discriminator.
ALTER TABLE "LocationAuditEntry" ADD CONSTRAINT "audit_target_check"
  CHECK (num_nonnulls("siteId", "zoneId") = 1);

-- The action enum — cheap to enforce, loud to violate.
ALTER TABLE "LocationAuditEntry" ADD CONSTRAINT "audit_action_check"
  CHECK ("action" IN ('create','published','renamed','boundary_set','boundary_cleared','merge'));

-- SPRINT-007 backfill: every existing PUBLIC site/zone gets a `create` audit
-- entry for its owner (dated at the row's own createdAt), making the owner
-- the first contributor. Where boundaryUpdatedById (SPRINT-006) names a
-- DIFFERENT pilot, that pilot also gets a backfilled `boundary_set` entry —
-- real history the owner-only backfill would otherwise drop. No null-owner
-- case to handle (the curated site seed was removed before this sprint).
-- Guarded with NOT EXISTS so this is safe to re-run by hand (Prisma itself
-- only ever applies a migration once, but an operator re-running this file
-- manually should not create duplicate backfill entries).
INSERT INTO "LocationAuditEntry" ("id", "siteId", "actorId", "action", "detail", "createdAt")
SELECT gen_random_uuid()::text, s."id", s."ownerId", 'create', jsonb_build_object('name', s."name"), s."createdAt"
  FROM "Site" s
 WHERE s."visibility" = 'public' AND s."ownerId" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "LocationAuditEntry" e
      WHERE e."siteId" = s."id" AND e."actorId" = s."ownerId" AND e."action" = 'create'
   );

INSERT INTO "LocationAuditEntry" ("id", "siteId", "actorId", "action", "detail", "createdAt")
SELECT gen_random_uuid()::text, s."id", s."boundaryUpdatedById", 'boundary_set', jsonb_build_object('backfill', true), s."updatedAt"
  FROM "Site" s
 WHERE s."visibility" = 'public' AND s."boundaryUpdatedById" IS NOT NULL AND s."boundaryUpdatedById" IS DISTINCT FROM s."ownerId"
   AND NOT EXISTS (
     SELECT 1 FROM "LocationAuditEntry" e
      WHERE e."siteId" = s."id" AND e."actorId" = s."boundaryUpdatedById" AND e."action" = 'boundary_set'
   );

INSERT INTO "LocationAuditEntry" ("id", "zoneId", "actorId", "action", "detail", "createdAt")
SELECT gen_random_uuid()::text, z."id", z."ownerId", 'create', jsonb_build_object('name', z."name"), z."createdAt"
  FROM "Zone" z
 WHERE z."visibility" = 'public' AND z."ownerId" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "LocationAuditEntry" e
      WHERE e."zoneId" = z."id" AND e."actorId" = z."ownerId" AND e."action" = 'create'
   );

INSERT INTO "LocationAuditEntry" ("id", "zoneId", "actorId", "action", "detail", "createdAt")
SELECT gen_random_uuid()::text, z."id", z."boundaryUpdatedById", 'boundary_set', jsonb_build_object('backfill', true), z."updatedAt"
  FROM "Zone" z
 WHERE z."visibility" = 'public' AND z."boundaryUpdatedById" IS NOT NULL AND z."boundaryUpdatedById" IS DISTINCT FROM z."ownerId"
   AND NOT EXISTS (
     SELECT 1 FROM "LocationAuditEntry" e
      WHERE e."zoneId" = z."id" AND e."actorId" = z."boundaryUpdatedById" AND e."action" = 'boundary_set'
   );
