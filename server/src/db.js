import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

export async function query(text, params = []) {
  const started = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - started;

  if (duration > 750) {
    console.warn(`Slow query (${duration}ms): ${text.replace(/\s+/g, " ").trim()}`);
  }

  return result;
}
