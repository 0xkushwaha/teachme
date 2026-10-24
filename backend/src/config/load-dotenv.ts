import { config } from 'dotenv';

/**
 * Loads a local .env file for development. Never overrides variables already present, so
 * production (where the orchestrator injects env vars) is unaffected. Imported first by entry points.
 */
config({ path: process.env.DOTENV_CONFIG_PATH ?? '.env', quiet: true });
