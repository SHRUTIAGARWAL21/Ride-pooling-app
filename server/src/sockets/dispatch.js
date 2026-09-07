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
