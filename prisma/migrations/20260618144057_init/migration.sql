-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "name" TEXT,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("provider","providerAccountId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("identifier","token")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" TEXT,
    "homeSiteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flight" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "source" TEXT NOT NULL DEFAULT 'web_upload',
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "igcSha256" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL DEFAULT '1',
    "parseWarnings" JSONB NOT NULL DEFAULT '[]',
    "failureReason" TEXT,
    "flightDate" DATE,
    "takeoffAt" TIMESTAMP(3),
    "landingAt" TIMESTAMP(3),
    "localTz" TEXT,
    "localUtcOffsetMinutes" INTEGER,
    "glider" TEXT,
    "recorder" TEXT,
    "durationS" INTEGER,
    "maxAltM" INTEGER,
    "altGainM" INTEGER,
    "maxClimbMs" DOUBLE PRECISION,
    "maxSinkMs" DOUBLE PRECISION,
    "altSource" TEXT,
    "trackDistM" INTEGER,
    "straightDistM" INTEGER,
    "takeoffLat" DOUBLE PRECISION,
    "takeoffLon" DOUBLE PRECISION,
    "landingLat" DOUBLE PRECISION,
    "landingLon" DOUBLE PRECISION,
    "bounds" JSONB,
    "takeoffSiteId" TEXT,
    "takeoffSiteName" TEXT,
    "landingSiteId" TEXT,
    "landingSiteName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Flight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlightData" (
    "flightId" TEXT NOT NULL,
    "rawIgc" BYTEA NOT NULL,
    "track" JSONB,

    CONSTRAINT "FlightData_pkey" PRIMARY KEY ("flightId")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'unknown',
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "countryCode" TEXT,
    "region" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceId" TEXT,
    "sourceUrl" TEXT,
    "license" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_handle_key" ON "Profile"("handle");

-- CreateIndex
CREATE INDEX "Flight_ownerId_flightDate_idx" ON "Flight"("ownerId", "flightDate");

-- CreateIndex
CREATE UNIQUE INDEX "Flight_ownerId_igcSha256_key" ON "Flight"("ownerId", "igcSha256");

-- CreateIndex
CREATE INDEX "Site_lat_lon_idx" ON "Site"("lat", "lon");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_id_fkey" FOREIGN KEY ("id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_homeSiteId_fkey" FOREIGN KEY ("homeSiteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flight" ADD CONSTRAINT "Flight_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flight" ADD CONSTRAINT "Flight_takeoffSiteId_fkey" FOREIGN KEY ("takeoffSiteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flight" ADD CONSTRAINT "Flight_landingSiteId_fkey" FOREIGN KEY ("landingSiteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightData" ADD CONSTRAINT "FlightData_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "Flight"("id") ON DELETE CASCADE ON UPDATE CASCADE;
