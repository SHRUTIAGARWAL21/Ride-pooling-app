// Pushes a new ride offer to online drivers over the live line.
// This is the SEAM between HTTP (a booking) and sockets (real-time delivery).

import { getIO } from "./index.js";

// Send "ride:request" to every online driver whose vehicle type matches.
// The passed "ride" must include passengers -> rider (name), which
// ride.service.js now returns.
export function dispatchRideRequest(ride) {
  // The room holds exactly the online drivers of THIS vehicle type.
  const room = `drivers:${ride.vehicleType}`;

  // Who is asking. passengers[0] is the booking rider (a solo ride has one).
  const riderName = ride.passengers?.[0]?.rider?.name ?? "A rider";

  // Send ONLY what a driver needs to decide — never the raw database row.
  const payload = {
    rideId: ride.id,
    vehicleType: ride.vehicleType,
    fare: ride.fareTotal, // a string like "69.32" (Decimal serialised)
    pickup: {
      lat: ride.pickupLat,
      lng: ride.pickupLng,
      address: ride.pickupAddress,
    },
    dropoff: {
      lat: ride.dropoffLat,
      lng: ride.dropoffLng,
      address: ride.dropoffAddress,
    },
    riderName,
  };

  const io = getIO();
  // .to(room).emit(...) delivers to EVERY socket in that room at once.
  io.to(room).emit("ride:request", payload);

  // How many drivers received it (0 if none online). Useful for logs/tests.
  const recipients = io.sockets.adapter.rooms.get(room)?.size ?? 0;
  console.log(`[dispatch] ride ${ride.id} -> ${room} (${recipients} online)`);
  return recipients;
}

// After a driver accepts: tell the rider WHO is coming, and tell the OTHER
// online drivers the ride is gone so their offer disappears.
// The passed "ride" must include driver (+ driverProfile) and passengers.
export function notifyRideAccepted(ride) {
  const io = getIO();
  const riderId = ride.passengers?.[0]?.riderId;
  const d = ride.driver;

  // 1) To the rider's own room: the driver + vehicle details they asked for.
  if (riderId) {
    io.to(`rider:${riderId}`).emit("ride:accepted", {
      rideId: ride.id,
      status: ride.status,
      // The rider needs the PIN to hand to the driver at pickup. This event
      // goes ONLY to the rider's room, so the driver never sees it.
      startPin: ride.startPin,
      driver: {
        name: d?.name,
        phone: d?.phone,
        vehicleType: d?.driverProfile?.vehicleType,
        vehicleNumber: d?.driverProfile?.vehicleNumber,
      },
    });
  }

  // 2) To the drivers' room: this ride is taken. We include who took it, so
  // the winning driver's own app can tell the "taken" was caused by them.
  io.to(`drivers:${ride.vehicleType}`).emit("ride:taken", {
    rideId: ride.id,
    acceptedBy: ride.driverId,
  });
}

// Push a status change to the people who care. Used by start / driver-cancel
// (re-open) / rider-cancel. The passed "ride" must include passengers.
export function notifyRideStatus(ride) {
  const io = getIO();
  const riderId = ride.passengers?.[0]?.riderId;
  const payload = { rideId: ride.id, status: ride.status };

  // The rider always cares about their ride's status.
  if (riderId) io.to(`rider:${riderId}`).emit("ride:status", payload);

  // If a driver is assigned, tell them too (e.g. the rider cancelled on them).
  if (ride.driverId) {
    io.to(`driver:${ride.driverId}`).emit("ride:status", payload);
  }

  // If the ride is cancelled, also clear any offer still showing to the pool.
  if (ride.status === "cancelled") {
    io.to(`drivers:${ride.vehicleType}`).emit("ride:taken", { rideId: ride.id });
  }
}
