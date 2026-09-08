// The background "clock". It cancels rides that nobody accepted in time.
// It runs on a timer, NOT because of any request — the first such code in the app.

import { config } from "../config/env.js";
import { expireStaleRides } from "../services/ride.service.js";
import { notifyRideStatus } from "../sockets/dispatch.js";

export function startSweeper() {
  // setInterval(fn, ms) runs fn every "ms" milliseconds, forever, on its own.
  const timer = setInterval(async () => {
    try {
      const cancelled = await expireStaleRides();

      // Tell each affected rider (and clear the offer from the pool), using the
      // SAME notifier the manual cancels use. On "cancelled" it sends
      // ride:status to the rider and ride:taken to the drivers room.
      for (const ride of cancelled) notifyRideStatus(ride);

      if (cancelled.length > 0) {
        console.log(`[sweeper] auto-cancelled ${cancelled.length} stale ride(s)`);
      }
    } catch (err) {
      // A single failure must never kill the timer, so we swallow + log it.
      console.error("[sweeper] error:", err);
    }
  }, config.sweepIntervalMs);

  console.log(
    `[sweeper] started (every ${config.sweepIntervalMs}ms, timeout ${config.rideTimeoutMs}ms)`
  );
  return timer;
}
