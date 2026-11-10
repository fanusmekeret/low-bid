import { prisma } from "../../lib/prisma.js";
import { realtime } from "../../sockets/realtime.js";

/** Stores an in-app notification and pushes it to the user's socket room. FCM push is added in phase 8. */
export async function notify(userId: bigint, type: string, title: string, body: string, data?: Record<string, unknown>) {
  const n = await prisma.notification.create({ data: { userId, type, title, body, data: data as object } });
  realtime().to(`user:${userId}`).emit("notification:new", { id: n.id.toString(), type, title, body, data });
  return n;
}
