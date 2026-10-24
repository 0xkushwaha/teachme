import { User } from '@prisma/client';

/** The only shape of a user ever returned to its owner. Never includes hashes or lock state. */
export function toSelfUser(user: User & { teacherProfile?: { id: string; slug: string; approvalStatus: string } | null }) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    status: user.status,
    timezone: user.timezone,
    phone: user.phone,
    emailVerified: Boolean(user.emailVerifiedAt),
    createdAt: user.createdAt,
    teacherProfile: user.teacherProfile
      ? { id: user.teacherProfile.id, slug: user.teacherProfile.slug, approvalStatus: user.teacherProfile.approvalStatus }
      : null,
  };
}
