// One place that pushes live events to clients. Works in three setups:
//   - the API process: emits through its Socket.IO server (the Redis adapter fans out to other nodes)
//   - a separate worker process: emits through @socket.io/redis-emitter
//   - tests and scripts with neither: events are dropped (or captured by a test sink)

export const NAMESPACE = '/live';
export const auctionRoom = (auctionId) => `auction:${auctionId}`;
export const userRoom = (userId) => `user:${userId}`;

let target = null; // something with .to(room).emit(event, payload)
let sink = null; // test hook

export function setRealtimeTarget(t) {
  target = t;
}

/** Tests: capture every emitted event. Returns the array the events are pushed into. */
export function captureRealtime() {
  sink = [];
  return sink;
}

const json = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));

export function emitTo(room, event, payload) {
  const body = json({ ...payload, serverTime: Date.now() });
  if (sink) sink.push({ room, event, payload: body });
  if (target) target.to(room).emit(event, body);
}

export const emitToAuction = (auctionId, event, payload) => emitTo(auctionRoom(auctionId), event, payload);
export const emitToUser = (userId, event, payload) => emitTo(userRoom(userId), event, payload);
