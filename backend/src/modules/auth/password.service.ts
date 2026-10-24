import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/** Argon2id with OWASP-recommended parameters (19 MiB, t=2, p=1). */
@Injectable()
export class PasswordService {
  private readonly options = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

  hash(password: string) {
    return argon2.hash(password, this.options);
  }

  async verify(hash: string, password: string) {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  needsRehash(hash: string) {
    return argon2.needsRehash(hash, this.options);
  }
}
