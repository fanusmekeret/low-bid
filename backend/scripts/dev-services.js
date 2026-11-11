// Starts the local MySQL and Redis containers (deployment/docker-compose.dev.yml) if they are
// not already running, and waits until both are healthy. Run by `bun run dev` before the API.
//
//   bun run services:up      # same thing on its own
//   bun run services:down    # stop the containers (data is kept in Docker volumes)
//   SKIP_DOCKER=1 bun run dev   # use a MySQL/Redis you run yourself
//
// If Docker Desktop is closed (macOS or Windows), it is opened and given up to 2 minutes to start.
// Then the database schema is brought up to date (`prisma db push`), so a pulled schema change
// applies by itself. A change that would delete data stops here and asks for `bun run db:reset`.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const COMPOSE_FILE = fileURLToPath(new URL('../../deployment/docker-compose.dev.yml', import.meta.url));
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const log = (msg) => console.log(`[services] ${msg}`);

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const dockerUp = () => run('docker', ['info'], { stdio: 'ignore' }).status === 0;
const compose = (...args) => run('docker', ['compose', '-f', COMPOSE_FILE, ...args], { stdio: 'inherit' });

/** True when DATABASE_URL and REDIS_URL point somewhere other than this machine. */
function usesRemoteServices() {
  const hostOf = (url) => {
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  };
  const hosts = [process.env.DATABASE_URL, process.env.REDIS_URL].filter(Boolean).map(hostOf);
  return hosts.length > 0 && hosts.every((h) => h && !LOCAL_HOSTS.has(h));
}

function openDockerDesktop() {
  if (process.platform === 'darwin') return run('open', ['-a', 'Docker']).status === 0;
  if (process.platform === 'win32') {
    const exe = 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe';
    if (!existsSync(exe)) return false;
    return run('cmd', ['/c', 'start', '""', exe]).status === 0;
  }
  // Linux: Docker Engine normally runs as a system service.
  return run('systemctl', ['--user', 'start', 'docker-desktop']).status === 0;
}

async function waitForDocker(seconds) {
  for (let i = 0; i < seconds; i += 2) {
    if (dockerUp()) return true;
    await Bun.sleep(2000);
  }
  return false;
}

async function up() {
  if (process.env.SKIP_DOCKER === '1') return log('SKIP_DOCKER=1: not touching containers');
  if (usesRemoteServices()) return log('DATABASE_URL and REDIS_URL are not local: not starting containers');

  if (run('docker', ['--version'], { stdio: 'ignore' }).status !== 0) {
    console.error('[services] Docker is not installed. Install Docker Desktop, or set SKIP_DOCKER=1 and run MySQL 8 and Redis yourself.');
    process.exit(1);
  }
  if (!dockerUp()) {
    log('Docker is not running; starting Docker Desktop…');
    if (!openDockerDesktop() || !(await waitForDocker(120))) {
      console.error('[services] Docker did not start. Open Docker Desktop (or start the Docker service) and run the command again.');
      process.exit(1);
    }
  }

  // `up -d` leaves running containers alone and starts stopped ones; `--wait` returns once the
  // health checks pass (MySQL takes ~20 s on its very first start while it creates the database).
  log('starting MySQL and Redis (deployment/docker-compose.dev.yml)…');
  const r = compose('up', '-d', '--wait', 'mysql', 'redis');
  if (r.status !== 0) {
    console.error('[services] could not start the containers. If port 3306 or 6379 is taken by a local MySQL or Redis, stop it or set SKIP_DOCKER=1.');
    process.exit(r.status ?? 1);
  }
  log('MySQL on 127.0.0.1:3306 and Redis on 127.0.0.1:6379 are ready');
  syncSchema();
}

/** Applies schema changes that keep data. Anything destructive needs an explicit reset. */
function syncSchema() {
  if (process.env.SKIP_SCHEMA_SYNC === '1') return;
  log('checking the database schema…');
  // No --accept-data-loss: Prisma refuses changes that would drop columns or data.
  const r = run('bunx', ['prisma', 'db', 'push', '--skip-generate'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status === 0) {
    log(/already in sync/i.test(out) ? 'schema is up to date' : 'schema updated');
    // Keep the Prisma client in step with the schema.
    run('bunx', ['prisma', 'generate'], { stdio: 'ignore' });
    return;
  }
  console.error(out.trim());
  console.error(`
[services] The database schema changed in a way that would delete data (e.g. a removed column).
[services] For local development, reset it (deletes local data, then reseeds roles, categories and demo auctions):
[services]
[services]     bun run db:reset
[services]
[services] Then run bun run dev again. (Set SKIP_SCHEMA_SYNC=1 to skip this check.)`);
  process.exit(1);
}

function down() {
  if (!dockerUp()) return log('Docker is not running: nothing to stop');
  process.exit(compose('stop', 'mysql', 'redis').status ?? 0);
}

if (process.argv[2] === 'down') down();
else await up();
