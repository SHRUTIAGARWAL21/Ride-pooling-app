// This file BUILDS the Express application (the request-handling brain).
// It does NOT start the server. Starting is index.js's job.
// Splitting them means tests can create an app without opening a network port.

import express from "express";
import cors from "cors";
import { config } from "./config/env.js";
import { authRouter } from "./routes/auth.routes.js";

// Create the application object. "app" is a function that knows how to take
// an incoming HTTP request and route it to the right handler.
const app = express();

// ---- Middleware: code that runs on EVERY request before your handlers ----

// 1) Allow the browser client (a different origin) to call this API.
//    Without this, the browser blocks the responses for security (CORS).
app.use(cors({ origin: config.clientUrl }));

// 2) Parse JSON request bodies into req.body (a JavaScript object).
//    Without this, req.body is undefined when the client POSTs JSON.
app.use(express.json());

// ---- Routes: what to do for a specific URL ----

// A health check. Load-balancers and you (during dev) hit this to ask
// "are you alive?". It touches no database, so a 200 here means the process runs.
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Mount the auth router under /api/auth. Every route inside authRouter is
// now prefixed with this path — so router.post("/register") becomes
// POST /api/auth/register.
app.use("/api/auth", authRouter);

// Export the built app so index.js (and later, tests) can use it.
export { app };
