// The WORKER for driver profiles. Business logic only — no HTTP here.

import { prisma } from "../config/prisma.js";

// Create the driver's profile the first time, or update it if it already
// exists. This "create-or-update" is so common that Prisma has one call for
// it: upsert. It decides which to do by looking for the "where" row.
export async function upsertDriverProfile({ userId, vehicleType, vehicleNumber }) {
  // Normalise the plate: trim spaces and uppercase, so "ka 01 ab 1234" and
  // "KA-01-AB-1234 " do not become two different-looking entries.
  const normalizedNumber = vehicleNumber.trim().toUpperCase();

  return prisma.driver.upsert({
    // Find the row by the user (userId is unique, so this matches 0 or 1 row).
    where: { userId },
    // If NO row is found -> create this one (first-time registration).
    create: { userId, vehicleType, vehicleNumber: normalizedNumber },
    // If a row IS found -> update these fields (driver changed their vehicle).
    update: { vehicleType, vehicleNumber: normalizedNumber },
  });
}

// Read one driver's own profile. Returns null if they have not registered yet.
export async function getDriverProfile(userId) {
  return prisma.driver.findUnique({ where: { userId } });
}
