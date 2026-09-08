// The WORKER for rides. Business logic only — no HTTP here.

import { prisma } from "../config/prisma.js";
import { estimateFare } from "./fare.service.js";
import { getDriverProfile } from "./driver.service.js";

// Create a new solo ride for a rider, plus that rider's passenger row.
export async function createRideForRider({ riderId, pickup, dropoff, vehicleType }) {
  // Price the trip for the CHOSEN type. The server computes this itself — it
  // never accepts a fare from the client.
  const { distanceKm, fareTotal } = estimateFare(pickup, dropoff, vehicleType);

  // $transaction wraps the writes so they are ALL-OR-NOTHING. If any line
  // inside throws, every write already made is rolled back.
  const ride = await prisma.$transaction(async (tx) => {
    const created = await tx.ride.create({
      data: {
        status: "requested",
        vehicleType, // remember which service was booked
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        pickupAddress: pickup.address,
        dropoffLat: dropoff.lat,
        dropoffLng: dropoff.lng,
        dropoffAddress: dropoff.address,
        fareTotal,
      },
    });

    await tx.ridePassenger.create({
      data: {
        rideId: created.id,
        riderId,
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        dropoffLat: dropoff.lat,
        dropoffLng: dropoff.lng,
      },
    });

    return tx.ride.findUnique({
      where: { id: created.id },
      // Include passengers, and each passenger's rider NAME only (never email
      // or hash). Dispatch uses this to show a driver who is requesting.
      include: {
        passengers: { include: { rider: { select: { name: true } } } },
      },
    });
  });

  return { ride, distanceKm };
}

// Claim a requested ride for a driver, SAFELY against two drivers racing to
// accept the same ride. Returns a small result object the controller maps to
// an HTTP status.
export async function acceptRideForDriver({ rideId, driverId }) {
  // The driver must have a vehicle profile: we need their type, and a driver
  // with no registered vehicle should not be accepting rides.
  const profile = await getDriverProfile(driverId);
  if (!profile) return { status: "no_profile" };

  // THE ATOMIC CLAIM. This is ONE database UPDATE with the conditions in the
  // WHERE. Only a row that is still requested, unclaimed, AND matches this
  // driver's vehicle type is changed. The database runs concurrent updates
  // one at a time, so if another driver already accepted, our WHERE now
  // matches nothing. result.count = 1 -> we won; 0 -> someone beat us.
  const result = await prisma.ride.updateMany({
    where: {
      id: rideId,
      status: "requested",
      driverId: null,
      vehicleType: profile.vehicleType,
    },
    data: { status: "accepted", driverId },
  });

  if (result.count === 0) {
    // We changed nothing. Read the ride to say WHY (missing vs already gone).
    const existing = await prisma.ride.findUnique({ where: { id: rideId } });
    if (!existing) return { status: "not_found" };
    return { status: "conflict" }; // already taken, cancelled, or wrong type
  }

  // We won. Load the full ride with the driver's details and the rider, both
  // to return to the driver and to notify over sockets.
  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    include: {
      driver: {
        select: {
          id: true,
          name: true,
          phone: true,
          driverProfile: { select: { vehicleType: true, vehicleNumber: true } },
        },
      },
      passengers: { include: { rider: { select: { name: true } } } },
    },
  });

  return { status: "accepted", ride };
}
