import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { getRedis } from '../config/redis.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';
import { logger } from '../utils/logger.js';
import { NAMESPACE, auctionRoom, setRealtimeTarget, userRoom } from './realtime.js';

const MAX_ROOMS_PER_SOCKET = 40;
const EVENTS_PER_10S = 40;
const ID = /^\d{1,19}$/;

/**
 * Socket.IO on the API's HTTP server. Read-only for clients: they join auction rooms and
 * receive events. Bids are always placed over REST so they get the same validation,
 * rate limits and idempotency as every other write.
 *
 * Client → server: auction:join { auctionId }, auction:leave { auctionId }, time:sync
 * Server → client: auction:bid { bidCount } (never an amount: bids are secret until the close),
 *                  auction:started, auction:closed { outcome, finalPrice, winnerAlias, paidBids, uniqueBids },
 *                  auction:cancelled, user:won, payment:updated, notification:new
 */
export async function initSockets(httpServer) {
  const io = new Server(httpServer, {
    path: '/socket.io',
    serveClient: false,
    cors: { origin: env.corsOrigins.length ? env.corsOrigins : false },
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 10_000, // clients only send tiny control messages
  });

  if (!env.isTest) {
    // Share rooms across API processes so a bid on one node reaches viewers on another.
    const { createAdapter } = await import('@socket.io/redis-adapter');
    const pub = getRedis().duplicate();
    const sub = getRedis().duplicate();
    io.adapter(createAdapter(pub, sub));
  }

  const live = io.of(NAMESPACE);

  // Guests may watch auctions; a token, if sent, must be valid (the app refreshes and reconnects).
  live.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next();
    try {
      const claims = verifyAccessToken(token);
      socket.data.userId = claims.sub;
      return next();
    } catch (err) {
      const e = new Error(err.code ?? 'AUTH_TOKEN_INVALID');
      e.data = { code: err.code ?? 'AUTH_TOKEN_INVALID' };
      return next(e);
    }
  });

  live.on('connection', (socket) => {
    if (socket.data.userId) socket.join(userRoom(socket.data.userId));

    let windowStart = Date.now();
    let count = 0;
    socket.use((_packet, next) => {
      const now = Date.now();
      if (now - windowStart > 10_000) { windowStart = now; count = 0; }
      count += 1;
      if (count > EVENTS_PER_10S) {
        logger.warn({ userId: socket.data.userId }, 'socket rate limit, disconnecting');
        socket.disconnect(true);
        return undefined;
      }
      return next();
    });

    const reply = (ack, body) => { if (typeof ack === 'function') ack({ ...body, serverTime: Date.now() }); };

    socket.on('auction:join', (payload, ack) => {
      const id = String(payload?.auctionId ?? '');
      if (!ID.test(id)) return reply(ack, { ok: false, code: 'INVALID_AUCTION_ID' });
      const joined = [...socket.rooms].filter((r) => r.startsWith('auction:')).length;
      if (joined >= MAX_ROOMS_PER_SOCKET) return reply(ack, { ok: false, code: 'TOO_MANY_ROOMS' });
      socket.join(auctionRoom(id));
      return reply(ack, { ok: true });
    });

    socket.on('auction:leave', (payload, ack) => {
      const id = String(payload?.auctionId ?? '');
      if (ID.test(id)) socket.leave(auctionRoom(id));
      reply(ack, { ok: true });
    });

    socket.on('time:sync', (_payload, ack) => reply(ack, { ok: true }));
  });

  setRealtimeTarget(live);
  return io;
}

/** For a separate worker process: emit through Redis without running a Socket.IO server. */
export async function initRealtimeEmitter() {
  const { Emitter } = await import('@socket.io/redis-emitter');
  setRealtimeTarget(new Emitter(getRedis().duplicate()).of(NAMESPACE));
}
