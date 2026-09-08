// The WORKER for rides. Business logic only — no HTTP here.

import { randomInt } from "node:crypto";
import { prisma } from "../config/prisma.js";
import { config } from "../config/env.js";
import { estimateFare } from "./fare.service.js";
import { getDriverProfile } from "./driver.service.js";

// Create a new solo ride for a rider, plus that rider's passenger row.
export async function createRideForRider({ riderId, pickup, dropoff, vehicleType }) {
  // Price the trip for the CHOSEN type. The server computes this itself — it
  // never accepts a fare from the client.
  const { distanceKm, fareTotal } = estimateFare(pickup, dropoff, vehicleType);

  // $transaction wraps the two WRITES so they are ALL-OR-NOTHING. We keep it
  // short — only the writes — and read the full ride afterwards. A short
  // transaction avoids timeouts on a far/cold cloud database. The options
  // give extra headroom: maxWait = how long to wait for a free connection,
  // timeout = how long the transaction may run.
  const created = await prisma.$transaction(
    async (tx) => {
      const ride = await tx.ride.create({
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
          rideId: ride.id,
          riderId,
          pickupLat: pickup.lat,
          pickupLng: pickup.lng,
          dropoffLat: dropoff.lat,
          dropoffLng: dropoff.lng,
        },
      });

      return ride; // just the id we need; full read happens below
    },
    { maxWait: 10000, timeout: 20000 },
  );

  // Read the full ride (with passengers + rider name) OUTSIDE the transaction.
  // This read needs no transactional guarantee, so it does not belong inside.
  const ride = await loadRideWithPeople(created.id);

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

  // Make the pickup PIN now, at accept. The rider will receive it (via the
  // ride:accepted event); the driver never gets it from us. It proves, at
  // Start, that the driver actually met the rider.
  const pin = generatePin();

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
    data: { status: "accepted", driverId, startPin: pin },
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

// Load a ride with the extra data our notifications and re-dispatch need:
// the passenger row (its riderId) and the rider's name.
function loadRideWithPeople(rideId) {
  return prisma.ride.findUnique({
    where: { id: rideId },
    include: { passengers: { include: { rider: { select: { name: true } } } } },
  });
}

// A random 4-digit PIN as a string, e.g. "0427". randomInt is unbiased and
// comes from Node's crypto module (better than Math.random for this).
function generatePin() {
  return String(randomInt(0, 10000)).padStart(4, "0");
}

// accepted -> in_progress. Only the ride's OWN driver, only while accepted.
// (driverId in the where = ownership; status in the where = the allowed state.)
export async function startRideByDriver({ rideId, driverId, pin }) {
  // The PIN is part of the WHERE: the ride starts only if the submitted pin
  // matches the stored one. We also clear the pin so it cannot be reused.
  const result = await prisma.ride.updateMany({
    where: { id: rideId, driverId, status: "accepted", startPin: pin },
    data: { status: "in_progress", startedAt: new Date(), startPin: null },
  });
  if (result.count === 0) {
    // Find out WHY it did not start.
    const existing = await prisma.ride.findUnique({ where: { id: rideId } });
    if (!existing) return { status: "not_found" };
    // Wrong driver, or not in the accepted state -> a plain conflict.
    if (existing.driverId !== driverId || existing.status !== "accepted")
      return { status: "conflict" };
    // It IS this driver's accepted ride, so the only thing left is a bad PIN.
    return { status: "bad_pin" };
  }
  return { status: "started", ride: await loadRideWithPeople(rideId) };
}

// DRIVER cancels while accepted -> back to the pool. accepted -> requested,
// driver cleared. The controller then RE-DISPATCHES the offer.
export async function driverCancelRide({ rideId, driverId }) {
  const result = await prisma.ride.updateMany({
    where: { id: rideId, driverId, status: "accepted" },
    data: {
      status: "requested",
      driverId: null,
      startPin: null,
      requestedAt: new Date(), // reset the wait clock: a fresh timer in the pool
    },
  });
  if (result.count === 0) {
    const existing = await prisma.ride.findUnique({ where: { id: rideId } });
    if (!existing) return { status: "not_found" };
    return { status: "conflict" };
  }
  return { status: "reopened", ride: await loadRideWithPeople(rideId) };
}

// RIDER cancels -> terminate. Allowed while requested OR accepted, and ONLY
// if the caller is actually a passenger of this ride.
export async function riderCancelRide({ rideId, riderId }) {
  const result = await prisma.ride.updateMany({
    where: {
      id: rideId,
      status: { in: ["requested", "accepted"] },
      // A RELATION filter: match only if this ride has a passenger row for
      // this rider. That is the ownership check, done inside the same query.
      passengers: { some: { riderId } },
    },
    data: { status: "cancelled" },
  });
  if (result.count === 0) {
    const existing = await prisma.ride.findUnique({
      where: { id: rideId },
      include: { passengers: true },
    });
    if (!existing) return { status: "not_found" };
    const isPassenger = existing.passengers.some((p) => p.riderId === riderId);
    if (!isPassenger) return { status: "forbidden" };
    return { status: "conflict" }; // already started / completed / cancelled
  }
  return { status: "cancelled", ride: await loadRideWithPeople(rideId) };
}

// in_progress -> completed. Only the ride's OWN driver, only while in_progress.
// Then finalize the fare on each passenger row.
export async function completeRideByDriver({ rideId, driverId }) {
  const result = await prisma.ride.updateMany({
    where: { id: rideId, driverId, status: "in_progress" },
    data: { status: "completed", completedAt: new Date() },
  });
  if (result.count === 0) {
    const existing = await prisma.ride.findUnique({ where: { id: rideId } });
    if (!existing) return { status: "not_found" };
    return { status: "conflict" };
  }

  // Finalize the fare. No pooling yet, so the single rider pays the FULL fare.
  // (When pooling arrives, we will divide fareTotal by the number of riders.)
  const priced = await prisma.ride.findUnique({
    where: { id: rideId },
    select: { fareTotal: true },
  });
  await prisma.ridePassenger.updateMany({
    where: { rideId },
    data: { fareShare: priced.fareTotal },
  });

  return { status: "completed", ride: await loadRideWithPeople(rideId) };
}

// Cancel every ride that has waited too long in the requested state. The
// background sweeper calls this on a timer (no request triggers it). Returns
// the rides it actually cancelled, so the caller can notify each rider.
export async function expireStaleRides() {
  // "Too old" = it entered the requested state before this moment.
  const cutoff = new Date(Date.now() - config.rideTimeoutMs);

  // Find the candidates, with the rider included so we can notify them.
  const stale = await prisma.ride.findMany({
    where: { status: "requested", requestedAt: { lt: cutoff } },
    include: { passengers: { include: { rider: { select: { name: true } } } } },
  });

  const cancelled = [];
  for (const ride of stale) {
    // Cancel each one SAFELY: only if it is STILL requested and still old.
    // If a driver accepted it a split second ago, this changes 0 rows and we
    // skip it — no wrongful cancel. (The same atomic trick as everywhere.)
    const res = await prisma.ride.updateMany({
      where: { id: ride.id, status: "requested", requestedAt: { lt: cutoff } },
      data: { status: "cancelled" },
    });
    if (res.count === 1) cancelled.push({ ...ride, status: "cancelled" });
  }
  return cancelled;
}
