import http from "http";
import { app } from "./app";
import { env } from "./config/env";
import { createSocketServer } from "./socket";
import { prisma } from "./lib/prisma";

const server = http.createServer(app);
createSocketServer(server);

const start = async () => {
  server.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Roamer backend listening on http://localhost:${env.PORT}`);
  });
};

void start();

const shutdown = async () => {
  await prisma.$disconnect();
  server.close(() => process.exit(0));
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
