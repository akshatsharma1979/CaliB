import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, "..");
const envFile = path.join(root, ".env");
const env = readEnvFile(envFile);

const preferredApiPort = toPort(process.env.PORT ?? env.PORT, 4000);
const preferredClientPort = toPort(process.env.CLIENT_PORT ?? env.CLIENT_PORT, 5173);

const apiPort = await findAvailablePort(preferredApiPort);
const clientPort = await findAvailablePort(preferredClientPort);

if (apiPort !== preferredApiPort) {
  console.log(`Port ${preferredApiPort} is in use, using API port ${apiPort} instead.`);
}

if (clientPort !== preferredClientPort) {
  console.log(`Port ${preferredClientPort} is in use, using client port ${clientPort} instead.`);
}

console.log(`Starting CaliB API on http://localhost:${apiPort}`);
console.log(`Starting dashboard on http://localhost:${clientPort}`);

const serverEnv = {
  ...process.env,
  PORT: String(apiPort),
  API_PORT: String(apiPort),
  CLIENT_ORIGIN: `http://localhost:${clientPort}`
};

const clientEnv = {
  ...process.env,
  API_PORT: String(apiPort),
  VITE_API_URL: ""
};

const commands = [
  ["npm", ["run", "dev", "--workspace", "server"], serverEnv],
  ["npm", ["run", "dev", "--workspace", "client", "--", "--port", String(clientPort)], clientEnv]
];

const children = commands.map(([command, args, childEnv]) =>
  spawn(command, args, {
    env: childEnv,
    stdio: "inherit",
    shell: process.platform === "win32"
  })
);

function stopAll(signal) {
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

process.on("SIGINT", () => stopAll("SIGINT"));
process.on("SIGTERM", () => stopAll("SIGTERM"));

for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      stopAll("SIGTERM");
      process.exit(code);
    }
  });
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((values, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return values;
      }

      const index = trimmed.indexOf("=");
      if (index === -1) {
        return values;
      }

      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
      values[key] = value;
      return values;
    }, {});
}

async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + 100; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(`No available port found from ${startPort} to ${startPort + 99}`);
}

function isPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", (error) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") {
        resolve(false);
        return;
      }
      reject(error);
    });

    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen(port);
  });
}

function toPort(value, fallback) {
  const port = Number(value ?? fallback);
  return Number.isInteger(port) && port > 0 ? port : fallback;
}
