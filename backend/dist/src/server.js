"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config");
const app_1 = require("./app");
const logger_1 = require("./utils/logger");
const cfg = (0, config_1.loadConfig)();
(0, app_1.createApp)(cfg).listen(cfg.port, () => logger_1.logger.info({ port: cfg.port, env: cfg.env }, 'Blue Code OS backend listening'));
process.on('unhandledRejection', (e) => logger_1.logger.error({ e: String(e) }, 'unhandledRejection'));
