// The RECEPTIONIST layer. It talks HTTP: it reads req, validates input,
// calls the worker (service), and sends the right res + status code.

import {
  registerUser,
  loginUser,
  getUserById,
} from "../services/auth.service.js";
import { signToken } from "../utils/jwt.js";

// The only two roles the app allows (matches the enum in schema.prisma).
const VALID_ROLES = ["rider", "driver"];

export async function register(req, res) {
  // req.body is the JSON the client sent (express.json() parsed it for us).
  // "?? {}" guards against req.body being undefined, so the lines below
  // never crash with "cannot read property of undefined".
  const { name, email, phone, password, role } = req.body ?? {};

  // ---- Validation: NEVER trust the client. Check every field. ----
  const errors = [];
  if (!name || typeof name !== "string") errors.push("name is required");
  if (!email || typeof email !== "string" || !email.includes("@"))
    errors.push("a valid email is required");
  if (!phone || typeof phone !== "string") errors.push("phone is required");
  if (!password || typeof password !== "string" || password.length < 8)
    errors.push("password must be at least 8 characters");
  if (!VALID_ROLES.includes(role))
    errors.push("role must be 'rider' or 'driver'");

  // If anything is wrong, stop here with 400 (Bad Request) and say what.
  if (errors.length > 0) {
    return res.status(400).json({ error: "Validation failed", details: errors });
  }

  // ---- Do the work, and handle the ways it can fail ----
  try {
    const user = await registerUser({ name, email, phone, password, role });
    // 201 = "Created". The correct status when a new resource is made.
    return res.status(201).json({ user });
  } catch (err) {
    // P2002 is Prisma's code for "a unique constraint failed" — here, the
    // email already exists. 409 = "Conflict". We give a clear, safe message.
    if (err.code === "P2002") {
      return res
        .status(409)
        .json({ error: "An account with this email already exists" });
    }
    // Any other error is unexpected. Log the real cause for us, but return a
    // generic message so we never leak internal details to the client.
    console.error("register error:", err);
    return res.status(500).json({ error: "Something went wrong" });
  }
}

export async function login(req, res) {
  const { email, password } = req.body ?? {};

  // Minimal validation: both fields must be present strings.
  if (!email || typeof email !== "string" || !password || typeof password !== "string") {
    return res.status(400).json({ error: "email and password are required" });
  }

  try {
    const user = await loginUser({ email, password });

    // SECURITY: one identical message whether the email is unknown OR the
    // password is wrong. Telling them "no such email" would let an attacker
    // discover which emails have accounts. 401 = not authenticated.
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // The user proved who they are. Give them a signed token to carry.
    // Payload holds only an id and role — nothing sensitive.
    const token = signToken({ sub: user.id, role: user.role });

    return res.json({ user, token });
  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({ error: "Something went wrong" });
  }
}

// Protected route: requireAuth runs FIRST and sets req.user, so by the time
// we get here we already know the caller is a valid, logged-in user.
export async function me(req, res) {
  const user = await getUserById(req.user.id);
  if (!user) {
    // The token was valid but the user no longer exists (e.g. deleted).
    return res.status(404).json({ error: "User not found" });
  }
  return res.json({ user });
}
