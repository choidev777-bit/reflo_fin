import { Pool } from "pg";

declare global {
  var __refloPgPool: Pool | undefined;
}

function databaseUrl(): string {
  const value = process.env.REFLO_DATABASE_URL?.trim();
  if (!value) throw new Error("REFLO_DATABASE_URL is required");
  return value;
}

export function getPool(): Pool {
  if (!globalThis.__refloPgPool) {
    globalThis.__refloPgPool = new Pool({
      connectionString: databaseUrl(),
      max: process.env.NODE_ENV === "test" ? 4 : 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  return globalThis.__refloPgPool;
}
