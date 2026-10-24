import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { AppConfig } from '../../config/app-config';

export interface AccessClaims {
  sub: string;
  role: Role;
  sid: string;
}

const ISSUER = 'teachme-api';
const AUDIENCE = 'teachme-web';

@Injectable()
export class TokenService {
  constructor(private readonly config: AppConfig) {}

  signAccess(claims: AccessClaims): string {
    return jwt.sign(claims, this.config.env.JWT_ACCESS_SECRET, {
      algorithm: 'HS256',
      expiresIn: this.config.env.ACCESS_TOKEN_TTL_SECONDS,
      issuer: ISSUER,
      audience: AUDIENCE,
    });
  }

  verifyAccess(token: string): AccessClaims | null {
    try {
      const payload = jwt.verify(token, this.config.env.JWT_ACCESS_SECRET, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      if (typeof payload === 'string') return null;
      return { sub: String(payload.sub), role: payload.role as Role, sid: String(payload.sid) };
    } catch {
      return null;
    }
  }
}
