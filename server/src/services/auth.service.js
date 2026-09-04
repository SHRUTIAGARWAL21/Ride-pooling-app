// The WORKER layer. Pure business logic. It knows nothing about HTTP.
// No req, no res here — just "given this data, do the work and return a result".
// That makes this file easy to reuse and easy to test.

import bcrypt from "bcryptjs";
import { prisma } from "../config/prisma.js";

// How much work bcrypt does. 10 is a common, safe default for 2026 hardware.
// Higher = more secure but slower. This is the "cost" we discussed.
const SALT_ROUNDS = 10;

// Fields that are safe to send back to the client.
// Notice passwordHash is NOT here — we must never leak it, even hashed.
const SAFE_USER_FIELDS = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  createdAt: true,
};

export async function registerUser({ name, email, phone, password, role }) {
  // Turn the plain password into a one-way hash. bcrypt creates the salt,
  // does the slow hashing, and packs the salt + cost + hash into one string.
  // "await" because hashing takes real time and returns a Promise.
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // Insert one row into the users table. Prisma writes the SQL for us.
  // "select" limits the returned columns to the safe ones above, so the
  // passwordHash never even leaves the database layer.
  const user = await prisma.user.create({
    data: { name, email: email.toLowerCase(), phone, passwordHash, role },
    select: SAFE_USER_FIELDS,
  });

  return user;
}

// Check an email + password. Returns the safe user if correct, else null.
// We return null (not different messages) for "no such email" vs "wrong
// password" on purpose — see the note in the controller.
export async function loginUser({ email, password }) {
  // Here we DO need the passwordHash, so we do not use "select".
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });
  if (!user) return null; // no account with this email

  // bcrypt.compare re-hashes the typed password with the stored salt and
  // checks it against the stored hash. It never "decrypts" anything.
  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) return null; // wrong password

  // Strip the hash before returning: "throw away passwordHash, keep the rest".
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}

// Fetch one user by id, safe fields only. Used by the protected /me route.
export async function getUserById(id) {
  return prisma.user.findUnique({
    where: { id },
    select: SAFE_USER_FIELDS,
  });
}
