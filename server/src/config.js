import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({
  path: path.resolve(dirname, "../../.env")
});

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://calib:calib@localhost:5432/calib",
  port: Number(process.env.PORT ?? 4000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173"
};
