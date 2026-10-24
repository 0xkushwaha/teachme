/** Writes the OpenAPI document for the versioned API to docs/openapi.json (contract for clients). */
import '../src/config/load-dotenv';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { buildOpenApi, configureApp } from '../src/app';

async function main() {
  process.env.OUTBOX_AUTOSTART = 'false';
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register({ workers: false }), { logger: false });
  configureApp(app);
  await app.init();
  const doc = buildOpenApi(app);
  const out = join(__dirname, '..', '..', 'docs', 'openapi.json');
  writeFileSync(out, JSON.stringify(doc, null, 2));
  console.log(`Wrote ${Object.keys(doc.paths).length} paths to ${out}`);
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
