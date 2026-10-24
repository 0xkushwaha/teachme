import { Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  teacherProfileId: string | null;
  emailVerified: boolean;
}
