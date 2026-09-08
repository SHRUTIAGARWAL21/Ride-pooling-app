-- AlterTable
ALTER TABLE "rides" ADD COLUMN     "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "rides_status_requestedAt_idx" ON "rides"("status", "requestedAt");
