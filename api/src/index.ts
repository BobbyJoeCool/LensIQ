import path from 'node:path';
import { ConfigError, loadConfig } from './config.js';
import { NotionApiSource } from './notion/source.js';
import { buildServer } from './server.js';
import { Store } from './store.js';

function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`LensIQ can't start: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const store = new Store(path.join(config.dataDir, 'lensiq.db'));
  const app = buildServer({
    store,
    notion: new NotionApiSource(config.notionToken),
    access: config.access,
    webDist: config.webDist,
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
  });

  if (!config.access) {
    app.log.warn('Cloudflare Access check is OFF (NODE_ENV=development). Never run like this in production.');
  }

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    store.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  app.listen({ host: config.host, port: config.port }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}

main();
