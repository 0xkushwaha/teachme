import { LoggerModule } from 'nestjs-pino';
import { loadEnv } from './env.schema';

/** Paths scrubbed from every log line: credentials, tokens, signatures, payment and personal data. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'req.headers["x-razorpay-signature"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.razorpay_signature',
  '*.encryptedRefreshToken',
  '*.email',
  '*.phone',
  '*.card',
  '*.vpa',
];

export function loggerModule() {
  const env = loadEnv();
  return LoggerModule.forRoot({
    pinoHttp: {
      level: env.LOG_LEVEL,
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      genReqId: (req) => (req as { id?: string }).id ?? '',
      autoLogging: { ignore: (req) => /\/health\/|\/metrics/.test(req.url ?? '') },
      customProps: () => ({ service: 'teachme-api' }),
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url?.split('?')[0] }),
      },
      transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } } : undefined,
    },
  });
}
