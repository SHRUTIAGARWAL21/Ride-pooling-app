-- CreateEnum
CREATE TYPE "RideStatus" AS ENUM ('requested', 'accepted', 'in_progress', 'completed', 'cancelled');

-- CreateTable
CREATE TABLE "rides" (
    "id" TEXT NOT NULL,
    "driverId" TEXT,
    "status" "RideStatus" NOT NULL DEFAULT 'requested',
    "isShareable" BOOLEAN NOT NULL DEFAULT false,
    "pickupLat" DOUBLE PRECISION NOT NULL,
    "pickupLng" DOUBLE PRECISION NOT NULL,
    "pickupAddress" TEXT NOT NULL,
    "dropoffLat" DOUBLE PRECISION NOT NULL,
    "dropoffLng" DOUBLE PRECISION NOT NULL,
    "dropoffAddress" TEXT NOT NULL,
    "routePolyline" TEXT,
    "fareTotal" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "rides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_passengers" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "pickupLat" DOUBLE PRECISION NOT NULL,
    "pickupLng" DOUBLE PRECISION NOT NULL,
    "dropoffLat" DOUBLE PRECISION NOT NULL,
    "dropoffLng" DOUBLE PRECISION NOT NULL,
    "fareShare" DECIMAL(10,2),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ride_passengers_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_passengers" ADD CONSTRAINT "ride_passengers_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_passengers" ADD CONSTRAINT "ride_passengers_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
