-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('car', 'auto', 'bike');

-- AlterTable
ALTER TABLE "rides" ADD COLUMN     "vehicleType" "VehicleType" NOT NULL DEFAULT 'car';
