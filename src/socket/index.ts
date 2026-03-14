import type { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { env } from "../config/env";
import { randomUUID } from "crypto";

export const createSocketServer = (httpServer: HttpServer) => {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN,
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    socket.on("chat:join", (payload: { conversationId: string }) => {
      if (!payload?.conversationId) return;
      socket.join(payload.conversationId);
    });

    socket.on(
      "chat:message",
      (payload: {
        conversationId: string;
        content: string;
        senderId: string;
      }) => {
        if (!payload?.conversationId || !payload?.content || !payload?.senderId) {
          return;
        }

        io.to(payload.conversationId).emit("chat:message", {
          ...payload,
          id: randomUUID(),
          createdAt: new Date().toISOString(),
        });
      }
    );
  });

  return io;
};
