// The WORKER for rides. Business logic only — no HTTP here.

import { prisma } from "../config/prisma.js";
import { estimateFare } from "./fare.service.js";

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
      include: { passengers: true },
    });
  });

  return { ride, distanceKm };
}
