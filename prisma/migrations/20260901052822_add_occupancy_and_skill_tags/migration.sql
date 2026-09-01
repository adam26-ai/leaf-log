-- AlterTable
ALTER TABLE "Flight" ADD COLUMN     "flightTypeTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "launchTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "occupancy" TEXT,
ADD COLUMN     "restrictedLandingField" BOOLEAN NOT NULL DEFAULT false;
