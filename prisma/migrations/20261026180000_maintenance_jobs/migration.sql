CREATE TABLE "MaintenanceJob" (
    "id" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MaintenanceJob_pkey" PRIMARY KEY ("id")
);
