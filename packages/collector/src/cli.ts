#!/usr/bin/env node
import { createCollectorServer } from "./server.js";

const server = await createCollectorServer();

try {
  await server.start();
} catch (error) {
  console.error("Failed to start collector", error);
  process.exitCode = 1;
}
