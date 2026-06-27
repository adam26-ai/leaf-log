-- Prisma v6 cannot represent CHECK constraints in schema.prisma, so these raw
-- SQL constraints intentionally live here. migrate-diff drift for these checks
-- is expected; do not delete them to "fix" drift.
ALTER TABLE "Flight" ADD CONSTRAINT "flight_visibility_check" CHECK ("visibility" IN ('private','friends','public'));
ALTER TABLE "Profile" ADD CONSTRAINT "profile_default_visibility_check" CHECK ("defaultVisibility" IN ('private','friends','public'));
