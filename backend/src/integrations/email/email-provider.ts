export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Sent as a header so providers that support it can de-duplicate. */
  idempotencyKey: string;
}

export interface EmailProvider {
  readonly configured: boolean;
  readonly name: string;
  send(message: EmailMessage): Promise<{ messageId: string }>;
}

export class EmailDeliveryError extends Error {
  constructor(
    message: string,
    readonly permanent = false,
  ) {
    super(message);
  }
}
