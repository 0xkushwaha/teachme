import { CreateAdminError, parseArgs, validatePassword } from '../../src/cli/create-admin';

describe('create-admin argument parsing', () => {
  it('reads --flag value and --flag=value forms', () => {
    expect(parseArgs(['--email', 'a@b.co', '--name=Jane Owner', '--reset-password'])).toEqual({ email: 'a@b.co', name: 'Jane Owner', resetPassword: true, help: false });
  });

  it('never accepts the password as an argument', () => {
    expect(() => parseArgs(['--email', 'a@b.co', '--password', 'Secret12345'])).toThrow(/ADMIN_PASSWORD/);
    expect(() => parseArgs(['--password=Secret12345'])).toThrow(CreateAdminError);
  });

  it('rejects unknown flags and missing values', () => {
    expect(() => parseArgs(['--role', 'ADMIN'])).toThrow(/Unknown argument/);
    expect(() => parseArgs(['--email'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--email', '--name', 'x'])).toThrow(/needs a value/);
  });

  it('enforces the app password rule', () => {
    expect(() => validatePassword('Str0ngAdminPass')).not.toThrow();
    expect(() => validatePassword('weakpass')).toThrow(/Password must be/);
    expect(() => validatePassword(undefined)).toThrow(CreateAdminError);
  });
});
