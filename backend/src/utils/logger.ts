import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
  // Mask phone numbers — show only last 4 digits (see CLAUDE.md Security)
  redact: {
    paths: ['phone', '*.phone', 'req.body.phone'],
    censor: (value) =>
      typeof value === 'string' && value.length > 4 ? `****${value.slice(-4)}` : '****',
  },
});
