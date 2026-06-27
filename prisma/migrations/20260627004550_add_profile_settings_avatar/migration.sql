-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "avatarUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "defaultVisibility" TEXT NOT NULL DEFAULT 'private';

-- CreateTable
CREATE TABLE "Avatar" (
    "profileId" TEXT NOT NULL,
    "image" BYTEA NOT NULL,
    "thumb" BYTEA NOT NULL,

    CONSTRAINT "Avatar_pkey" PRIMARY KEY ("profileId")
);

-- AddForeignKey
ALTER TABLE "Avatar" ADD CONSTRAINT "Avatar_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
