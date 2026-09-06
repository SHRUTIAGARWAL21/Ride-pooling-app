// This file BUILDS the Express application (the request-handling brain).
// It does NOT start the server. Starting is index.js's job.
// Splitting them means tests can create an app without opening a network port.

import express from "express";
import cors from "cors";
import { config } from "./config/env.js";
import { authRouter } from "./routes/auth.routes.js";
import { rideRouter } from "./routes/ride.routes.js";

const app = express();

// ---- Middleware: code that runs on EVERY request before your handlers ----

// 1) Allow the browser client (a different origin) to call this API.
app.use(cors({ origin: config.clientUrl }));

// 2) Parse JSON request bodies into req.body (a JavaScript object).
app.use(express.json());

// ---- Routes ----

// Health check — touches no database, so a 200 means the process runs.
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Auth routes: register, login, me. Prefix /api/auth.
app.use("/api/auth", authRouter);

// Ride routes: book a ride (more added later). Prefix /api/rides.
app.use("/api/rides", rideRouter);

// Export the built app so index.js (and later, tests) can use it.
export { app };
