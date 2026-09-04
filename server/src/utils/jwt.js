// The ONLY place that signs and verifies JWTs. Everything else calls these,
// so the secret and expiry live in one spot.

import jwt from "jsonwebtoken";
import { config } from "../config/env.js";

// How long a token stays valid. After this, the user must log in again.
// 7 days is a reasonable balance for a learning app.
const EXPIRES_IN = "7d";

// Build a signed token from a payload (e.g. { sub: userId, role }).
// jwt.sign adds the signature using our secret and sets the expiry.
export function signToken(payload) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: EXPIRES_IN });
}

// Check a token's signature and expiry. Returns the payload if valid.
// IMPORTANT: this THROWS if the token is missing, tampered with, or expired —
// so callers must wrap it in try/catch.
export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}
