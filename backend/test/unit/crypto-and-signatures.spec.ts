import { createHmac } from 'crypto';
import { decrypt, encrypt, hashRequest, safeEqual } from '../../src/utils/crypto';
import { RazorpayGateway } from '../../src/integrations/razorpay/razorpay.gateway';
import type { AppConfig } from '../../src/config/app-config';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('encryption at rest', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const a = encrypt('1//refresh-token', KEY);
    const b = encrypt('1//refresh-token', KEY);
    expect(a).not.toBe(b);
    expect(decrypt(a, KEY)).toBe('1//refresh-token');
  });
  it('detects tampering (GCM auth tag)', () => {
    const env = Buffer.from(encrypt('secret', KEY), 'base64');
    env[env.length - 1] ^= 1;
    expect(() => decrypt(env.toString('base64'), KEY)).toThrow();
  });
});

describe('helpers', () => {
  it('safeEqual compares in constant time and handles length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
  it('hashRequest is insensitive to key order', () => {
    expect(hashRequest('POST', '/x', { a: 1, b: [1, { c: 2, d: 3 }] })).toBe(hashRequest('POST', '/x', { b: [1, { d: 3, c: 2 }], a: 1 }));
  });
});

describe('Razorpay signature verification', () => {
  const config = {
    env: { RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: 'key_secret_123', RAZORPAY_WEBHOOK_SECRET: 'whsec_456' },
    razorpayConfigured: true,
    isProduction: false,
  } as unknown as AppConfig;
  const gw = new RazorpayGateway(config);

  it('accepts a valid checkout signature (HMAC of order_id|payment_id)', () => {
    const sig = createHmac('sha256', 'key_secret_123').update('order_A1|pay_B2').digest('hex');
    expect(gw.verifyCheckoutSignature('order_A1', 'pay_B2', sig)).toBe(true);
  });
  it('rejects signatures for a different payment or secret', () => {
    const sig = createHmac('sha256', 'key_secret_123').update('order_A1|pay_B2').digest('hex');
    expect(gw.verifyCheckoutSignature('order_A1', 'pay_OTHER', sig)).toBe(false);
    const wrong = createHmac('sha256', 'nope').update('order_A1|pay_B2').digest('hex');
    expect(gw.verifyCheckoutSignature('order_A1', 'pay_B2', wrong)).toBe(false);
  });
  it('verifies webhooks against the exact raw body', () => {
    const body = Buffer.from('{"event":"payment.captured","payload":{}}');
    const sig = createHmac('sha256', 'whsec_456').update(body).digest('hex');
    expect(gw.verifyWebhookSignature(body, sig)).toBe(true);
    expect(gw.verifyWebhookSignature(Buffer.from('{"event":"payment.captured", "payload":{}}'), sig)).toBe(false);
  });
});
