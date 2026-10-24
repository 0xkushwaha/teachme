import { Injectable } from '@nestjs/common';
import { Env, loadEnv } from './env.schema';

/** Typed, validated configuration. Secrets never leave the backend. */
@Injectable()
export class AppConfig {
  readonly env: Env;

  constructor() {
    this.env = loadEnv();
  }

  get isProduction() {
    return this.env.NODE_ENV === 'production';
  }
  get isTest() {
    return this.env.NODE_ENV === 'test';
  }
  get corsOrigins(): string[] {
    return this.env.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  get razorpayConfigured() {
    return Boolean(this.env.RAZORPAY_KEY_ID && this.env.RAZORPAY_KEY_SECRET);
  }
  get razorpayWebhookConfigured() {
    return Boolean(this.env.RAZORPAY_WEBHOOK_SECRET);
  }
  get googleConfigured() {
    return Boolean(this.env.GOOGLE_CLIENT_ID && this.env.GOOGLE_CLIENT_SECRET && this.env.GOOGLE_REDIRECT_URI);
  }
  get emailConfigured() {
    return Boolean(this.env.SMTP_HOST);
  }
}
