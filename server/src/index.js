import cors from "cors";
import express from "express";
import fs from "node:fs";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import router from "./routes.js";
import { pool } from "./db.js";

const app = express();
const dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(dirname, "../../client/dist");

app.use(helmet());
app.use(cors({ origin: config.clientOrigin }));
app.use(express.json());

app.use("/api", router);

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

app.use((error, _req, res, _next) => {
  console.error(error);

  const databaseError = getDatabaseError(error);
  res.status(error.status ?? databaseError?.status ?? 500).json({
    error: databaseError?.message ?? error.message ?? "Unexpected server error",
    details: error.details ?? databaseError?.details
  });
});

const server = app.listen(config.port, () => {
  console.log(`CaliB API listening on http://localhost:${config.port}`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${config.port} is already in use. Stop that process or set PORT to another value.`);
    process.exit(1);
  }

  console.error(error);
  process.exit(1);
});

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  console.log("Shutting down API server");
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

function getDatabaseError(error) {
  if (error.code === "28P01") {
    return {
      status: 503,
      message: "Database authentication failed. Check DATABASE_URL credentials.",
      details: { code: error.code }
    };
  }

  if (error.code === "ECONNREFUSED") {
    return {
      status: 503,
      message: "Database is not reachable. Start PostgreSQL and load the CSV data.",
      details: { code: error.code }
    };
  }

  if (error.code === "3D000") {
    return {
      status: 503,
      message: "Database does not exist. Create the database or update DATABASE_URL.",
      details: { code: error.code }
    };
  }

  if (error.code === "42P01") {
    return {
      status: 503,
      message: "Database schema is missing. Run the ETL command to create tables and load data.",
      details: { code: error.code }
    };
  }

  return null;
}
