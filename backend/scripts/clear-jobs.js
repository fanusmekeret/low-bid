// Empties the auction job queue in Redis. Used by `bun run db:reset`: after the database is
// recreated, jobs scheduled for the old auctions would only fail.
import { getQueue } from '../src/jobs/queue.js';

try {
  const queue = getQueue();
  await queue.obliterate({ force: true });
  console.log('✓ cleared scheduled auction jobs');
  await queue.close();
} catch (err) {
  console.warn(`! could not clear auction jobs (${err.message}); old jobs will fail harmlessly`);
}
process.exit(0);
