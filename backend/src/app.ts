import 'reflect-metadata';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config';
import { loadEnv } from './config/env.schema';

export const API_PREFIX = 'api';

export async function createApp(opts: { workers?: boolean; logger?: boolean } = {}): Promise<NestExpressApplication> {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register({ workers: opts.workers ?? env.RUN_WORKERS_IN_API }), {
    rawBody: true, // needed for Razorpay webhook signature verification
    bufferLogs: true,
  });
  if (opts.logger !== false) app.useLogger(app.get(Logger));
  configureApp(app);
  return app;
}

export function configureApp(app: NestExpressApplication) {
  const config = app.get(AppConfig);
  app.set('trust proxy', config.env.TRUST_PROXY);
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '200kb' });
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: config.isProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
    }),
  );
  app.use(compression());
  app.use(cookieParser());
  app.enableCors({
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key', 'Authorization', 'X-Request-Id'],
    maxAge: 600,
  });
  app.setGlobalPrefix(API_PREFIX, { exclude: ['metrics'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } }),
  );
  app.enableShutdownHooks();

  if (!config.isProduction) setupSwagger(app);
  return app;
}

export function buildOpenApi(app: INestApplication) {
  const doc = new DocumentBuilder()
    .setTitle('TeachMe API')
    .setDescription(
      'Versioned REST API for the TeachMe tutoring platform. Browser clients authenticate with HttpOnly cookies and must send X-CSRF-Token on unsafe requests; programmatic clients use Bearer tokens from POST /auth/token. See docs/api.md.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addCookieAuth('tm_at')
    .build();
  return SwaggerModule.createDocument(app, doc);
}

function setupSwagger(app: INestApplication) {
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, buildOpenApi(app));
}
