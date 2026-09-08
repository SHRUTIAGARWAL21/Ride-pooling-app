// Sets up the live line (Socket.io): who is connected, and which room they are in.

import { Server } from "socket.io";
import { config } from "../config/env.js";
import { verifyToken } from "../utils/jwt.js";
import { getDriverProfile } from "../services/driver.service.js";

// Module-level holder so other files can grab the server via getIO() and emit.
let io;

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: config.clientUrl },
  });

  // ---- AUTH: runs once per socket, BEFORE "connection" ----
  // This is the socket version of the requireAuth middleware. If it rejects,
  // the socket never connects at all.
  io.use((socket, next) => {
    // The client attaches the token when it connects: io(url, { auth: { token } }).
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Missing auth token"));

    try {
      const payload = verifyToken(token);
      // Attach identity to the socket, so every handler below knows who it is.
      socket.user = { id: payload.sub, role: payload.role };
      next(); // no error -> allow the connection
    } catch {
      next(new Error("Invalid or expired token")); // reject the connection
    }
  });

  // Only authenticated sockets reach here.
  io.on("connection", (socket) => {
    console.log(
      "[socket] connected:",
      socket.id,
      "user:",
      socket.user.id,
      socket.user.role,
    );

    // Each user joins their OWN private room, so we can message ONE specific
    // person later. A rider hears about THEIR ride; a driver hears when, say,
    // a rider cancels the ride that driver had accepted. This is separate from
    // the "drivers:<type>" pool, which a driver joins only on "Go online".
    if (socket.user.role === "rider") {
      socket.join(`rider:${socket.user.id}`);
    } else if (socket.user.role === "driver") {
      socket.join(`driver:${socket.user.id}`);
    }

    // A DRIVER taps "Go online" -> this event. We put them in the room for
    // their vehicle type, so ride offers of that type reach them.
    socket.on("driver:goOnline", async () => {
      if (socket.user.role !== "driver") return; // ignore if not a driver

      // We need their vehicle type to pick the room. It lives in their profile.
      const profile = await getDriverProfile(socket.user.id);
      if (!profile) {
        socket.emit("driver:error", { message: "Register a vehicle first" });
        return;
      }

      const room = `drivers:${profile.vehicleType}`;
      socket.join(room); // add this socket to the room ("whiteboard")
      socket.data.onlineRoom = room; // remember it, so goOffline can leave it

      socket.emit("driver:online", { room, vehicleType: profile.vehicleType });

      // How many drivers of this type are now online (proof the room works).
      const size = io.sockets.adapter.rooms.get(room)?.size ?? 0;
      console.log(
        `[socket] driver online: ${socket.user.id} -> ${room} (size ${size})`,
      );
    });

    // A DRIVER taps "Go offline" -> leave the room, stop receiving offers.
    socket.on("driver:goOffline", () => {
      const room = socket.data.onlineRoom;
      if (!room) return;
      socket.leave(room);
      socket.data.onlineRoom = null;
      socket.emit("driver:offline", { room });
      console.log(`[socket] driver offline: ${socket.user.id} -> ${room}`);
    });

    // On hang-up, Socket.io removes this socket from ALL rooms automatically.
    // So a dropped driver leaves the pool with no extra work from us.
    socket.on("disconnect", (reason) => {
      console.log("[socket] disconnected:", socket.id, "-", reason);
    });
  });

  return io;
}

// Other modules call this to emit. Throws if used before initSocket ran.
export function getIO() {
  if (!io) throw new Error("Socket.io is not initialised yet");
  return io;
}
