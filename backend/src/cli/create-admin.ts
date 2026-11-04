/*
 * Creates the first ADMIN account, or promotes an existing account to ADMIN. Safe to run in production.
 *
 * Lives under src/ so `nest build` compiles it into dist/ and it runs inside the production image:
 *   node dist/cli/create-admin.js --email owner@example.com --name "Jane Owner"     (or: npm run admin:create -- ...)
 *   npm run admin:create:dev -- --email ... --name ...                              (local, via ts-node)
 *
 * Inputs: --email / ADMIN_EMAIL, --name / ADMIN_NAME, and the password from ADMIN_PASSWORD or an
 * interactive hidden prompt. The password is never accepted as a CLI argument (it would land in shell history).
 * Idempotent: re-running for an existing ADMIN changes nothing (unless --reset-password is passed).
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { isEmail } from 'class-validator';
import * as readline from 'readline';
import { Writable } from 'stream';
import { PASSWORD_MESSAGE, PASSWORD_RULE } from '../modules/auth/dto/auth.dto';
import { PasswordService } from '../modules/auth/password.service';

export interface CreateAdminInput {
  email: string;
  fullName?: string;
  /** Required when creating; when promoting it is only used with `resetPassword`. */
  password?: string;
  resetPassword?: boolean;
}

export type CreateAdminOutcome = 'created' | 'promoted' | 'already-admin' | 'password-reset';

export interface CreateAdminResult {
  outcome: CreateAdminOutcome;
  userId: string;
  email: string;
  previousRole?: string;
}

export class CreateAdminError extends Error {}

export function normaliseEmail(email: string) {
  return email.trim().toLowerCase();
}

export function validatePassword(password: string | undefined): asserts password is string {
  if (!password || !PASSWORD_RULE.test(password)) throw new CreateAdminError(PASSWORD_MESSAGE);
}

export async function createOrPromoteAdmin(prisma: PrismaClient, input: CreateAdminInput, passwords = new PasswordService()): Promise<CreateAdminResult> {
  const email = normaliseEmail(input.email ?? '');
  if (!isEmail(email) || email.length > 254) throw new CreateAdminError(`"${input.email}" is not a valid email address`);
  const fullName = input.fullName?.trim();
  if (fullName !== undefined && (fullName.length < 2 || fullName.length > 100)) throw new CreateAdminError('Full name must be 2-100 characters');
  if (input.password !== undefined || input.resetPassword) validatePassword(input.password);

  const existing = await prisma.user.findUnique({ where: { email } });
  const now = new Date();

  if (!existing) {
    if (!fullName) throw new CreateAdminError('No account exists with that email; --name (or ADMIN_NAME) is required to create one');
    validatePassword(input.password);
    const passwordHash = await passwords.hash(input.password);
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, passwordHash, fullName, role: 'ADMIN', status: 'ACTIVE', emailVerifiedAt: now, privacyConsentAt: now },
      });
      await audit(tx, user.id, 'admin.bootstrap_created', {});
      return { outcome: 'created' as const, userId: user.id, email };
    });
  }

  if (existing.deletedAt || existing.status !== 'ACTIVE')
    throw new CreateAdminError(`Account ${email} is ${existing.status}${existing.deletedAt ? ' (deleted)' : ''}; refusing to promote it. Reactivate it first or use a different email.`);

  const passwordHash = input.resetPassword ? await passwords.hash(input.password!) : undefined;
  if (existing.role === 'ADMIN' && !passwordHash) return { outcome: 'already-admin', userId: existing.id, email };

  return prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: existing.id },
      data: {
        role: 'ADMIN',
        emailVerifiedAt: existing.emailVerifiedAt ?? now,
        ...(passwordHash ? { passwordHash, failedLoginCount: 0, lockedUntil: null } : {}),
      },
    });
    if (passwordHash) {
      // A credential reset must log out every existing session.
      await tx.session.updateMany({ where: { userId: existing.id, revokedAt: null }, data: { revokedAt: now } });
    }
    if (existing.role !== 'ADMIN') {
      await audit(tx, existing.id, 'admin.bootstrap_promoted', { previousRole: existing.role, passwordReset: !!passwordHash });
      return { outcome: 'promoted' as const, userId: existing.id, email, previousRole: existing.role };
    }
    await audit(tx, existing.id, 'admin.bootstrap_password_reset', {});
    return { outcome: 'password-reset' as const, userId: existing.id, email };
  });
}

function audit(tx: Prisma.TransactionClient, userId: string, action: string, metadata: Prisma.InputJsonObject) {
  // actorId is null: the change was made from the server CLI, not by a signed-in user.
  return tx.auditLog.create({ data: { actorId: null, action, entityType: 'User', entityId: userId, userAgent: 'cli:create-admin', metadata } });
}

// ---------------------------------------------------------------------------------------------- CLI

const USAGE = `Usage: node dist/cli/create-admin.js --email <email> [--name "<full name>"] [--reset-password]

  --email            Account email (or ADMIN_EMAIL)
  --name             Full name; required when the account does not exist yet (or ADMIN_NAME)
  --reset-password   Also set a new password on an existing account
  Password:          ADMIN_PASSWORD env var, otherwise prompted for (hidden) when run in a terminal.
                     ${PASSWORD_MESSAGE}.`;

export function parseArgs(argv: string[]) {
  const out: { email?: string; name?: string; resetPassword: boolean; help: boolean } = { resetPassword: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined || v.startsWith('--')) throw new CreateAdminError(`${flag} needs a value`);
      return v;
    };
    if (flag === '--email') out.email = value();
    else if (flag === '--name') out.name = value();
    else if (flag === '--reset-password') out.resetPassword = true;
    else if (flag === '--help' || flag === '-h') out.help = true;
    else if (flag === '--password') throw new CreateAdminError('Refusing --password: pass it via ADMIN_PASSWORD or the interactive prompt so it does not end up in shell history');
    else throw new CreateAdminError(`Unknown argument: ${arg}`);
  }
  return out;
}

function promptHidden(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, cb) {
      if (!muted) process.stdout.write(chunk, encoding);
      cb();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function readPassword(): Promise<string> {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (!process.stdin.isTTY) throw new CreateAdminError('Set ADMIN_PASSWORD or run in an interactive terminal to be prompted for the password');
  const first = await promptHidden('Password: ');
  validatePassword(first);
  const second = await promptHidden('Confirm password: ');
  if (first !== second) throw new CreateAdminError('Passwords do not match');
  return first;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const email = args.email ?? process.env.ADMIN_EMAIL;
  if (!email) throw new CreateAdminError(`--email (or ADMIN_EMAIL) is required\n\n${USAGE}`);
  const fullName = args.name ?? process.env.ADMIN_NAME;

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { email: normaliseEmail(email) }, select: { id: true } });
    const needsPassword = !existing || args.resetPassword;
    const password = needsPassword ? await readPassword() : undefined;
    const result = await createOrPromoteAdmin(prisma, { email, fullName, password, resetPassword: args.resetPassword });
    const messages: Record<CreateAdminOutcome, string> = {
      created: `Created ADMIN account ${result.email} (id ${result.userId}). Email marked verified; sign in at the web app.`,
      promoted: `Promoted ${result.email} (id ${result.userId}) from ${result.previousRole} to ADMIN. Takes effect on their next request.`,
      'already-admin': `${result.email} (id ${result.userId}) is already an ADMIN; nothing changed.`,
      'password-reset': `${result.email} (id ${result.userId}) is already an ADMIN; password reset and existing sessions signed out.`,
    };
    process.stdout.write(`${messages[result.outcome]}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err instanceof CreateAdminError ? `Error: ${err.message}` : err);
    process.exitCode = 1;
  });
}
