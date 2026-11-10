import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Emitter } from "@socket.io/redis-emitter";
import { redis } from "../lib/redis.js";
import { verifyAccessToken } from "../middleware/auth.js";

/** Anything that can broadcast to /live rooms: the Socket.IO server (web) or a Redis emitter (worker). */
interface Broadcaster {
  to(room: string): { emit(event: string, payload: unknown): unknown };
}

let broadcaster: Broadcaster | undefined;

/** Web process: start the Socket.IO server. Rooms are shared across nodes through Redis. */
export function attachRealtime(http: HttpServer, corsOrigins: string[]) {
  const io = new Server(http, { cors: { origin: corsOrigins }, serveClient: false });
  io.adapter(createAdapter(redis().duplicate(), redis().duplicate()));
  const live = io.of("/live");

  live.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (token) {
      try {
        socket.data.userId = verifyAccessToken(token).sub;
      } catch {
        return next(new Error("invalid token"));
      }
    }
    next(); // guests are allowed read-only
  });

  live.on("connection", (socket) => {
    if (socket.data.userId) socket.join(`user:${socket.data.userId}`);
    socket.emit("server:time", { serverTime: Date.now() });

    // Clients may only join auction rooms; there are no write events.
    socket.on("auction:join", (msg: { auctionId?: unknown }) => {
      const id = String(msg?.auctionId ?? "");
      if (/^\d{1,19}$/.test(id)) socket.join(`auction:${id}`);
    });
    socket.on("auction:leave", (msg: { auctionId?: unknown }) => {
      socket.leave(`auction:${String(msg?.auctionId ?? "")}`);
    });
  });

  broadcaster = live;
  return io;
}

/** Returns the broadcaster; in a process without a Socket.IO server it publishes through Redis. */
export function realtime(): Broadcaster {
  broadcaster ??= new Emitter(redis()).of("/live");
  return broadcaster;
}
