import { loadConfig } from './config';
import { createApp } from './app';
import { logger } from './utils/logger';

const cfg = loadConfig();
createApp(cfg).listen(cfg.port, () => logger.info({ port: cfg.port, env: cfg.env }, 'Blue Code OS backend listening'));
process.on('unhandledRejection', (e) => logger.error({ e: String(e) }, 'unhandledRejection'));
