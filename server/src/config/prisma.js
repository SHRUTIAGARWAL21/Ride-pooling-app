// One shared Prisma client for the whole app.
// Prisma GENERATED this client from schema.prisma during the migration.
// It knows every model and field, so calls like prisma.user.create(...)
// are fully typed and autocompleted in your editor.

import { PrismaClient } from "@prisma/client";

// Create a single instance and reuse it everywhere.
// Each PrismaClient opens a pool of database connections, so we must NOT
// create a new one per request — that would exhaust the database's connections.
// "log" prints the SQL Prisma runs, which is great while learning.
export const prisma = new PrismaClient({
  log: ["query", "warn", "error"],
});
