import { createApp } from './app';
import { AppConfig } from './config/app-config';

async function bootstrap() {
  const app = await createApp();
  const config = app.get(AppConfig);
  const server = await app.listen(config.env.PORT, '0.0.0.0');
  // Keep-alive slightly above typical load balancer idle timeouts (60s) to avoid 502s.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 30_000;
}

bootstrap().catch((err) => {
  console.error('Fatal: API failed to start', err);
  process.exit(1);
});
