import { z } from 'zod';

/**
 * Platform settings stored in `PlatformSetting`. Every key has a schema and a default so the
 * platform works on an empty table; admins override via /admin/settings.
 */
export const settingSchemas = {
  'booking.rules': z.object({
    holdMinutes: z.number().int().min(5).max(30),
    slotStepMinutes: z.number().int().refine((v) => [15, 30, 60].includes(v), 'must be 15, 30 or 60'),
    allowedDurations: z.array(z.number().int().min(15).max(240)).min(1),
  }),
  'pricing.rules': z.object({
    currency: z.literal('INR'),
    platformFeeBps: z.number().int().min(0).max(5000),
    taxBps: z.number().int().min(0).max(5000),
    taxBase: z.enum(['PLATFORM_FEE', 'SUBTOTAL']),
    minHourlyRateMinor: z.number().int().min(100),
    maxHourlyRateMinor: z.number().int().max(100_000_00),
  }),
  'policy.cancellation': z.object({
    fullRefundHours: z.number().min(0).max(168),
    partialRefundHours: z.number().min(0).max(168),
    partialRefundPercent: z.number().int().min(0).max(100),
  }),
  'policy.reschedule': z.object({
    minHoursBefore: z.number().min(0).max(168),
    maxReschedules: z.number().int().min(0).max(10),
  }),
  'notifications.reminders': z.object({
    offsetsMinutes: z.array(z.number().int().min(5).max(10080)).max(5),
    adminAlertEmail: z.string().email().nullable(),
  }),
  'features.flags': z.object({
    studentRegistration: z.boolean(),
    teacherRegistration: z.boolean(),
    googleCalendarSync: z.boolean(),
    meetCreation: z.boolean(),
    teacherSelfPricing: z.boolean(),
    maintenanceBanner: z.string().max(280).nullable(),
  }),
} as const;

export type SettingKey = keyof typeof settingSchemas;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingSchemas)[K]>;

export const settingDefaults: { [K in SettingKey]: SettingValue<K> } = {
  'booking.rules': { holdMinutes: 10, slotStepMinutes: 30, allowedDurations: [30, 45, 60, 90, 120] },
  'pricing.rules': {
    currency: 'INR',
    platformFeeBps: 500,
    taxBps: 1800,
    taxBase: 'PLATFORM_FEE',
    minHourlyRateMinor: 200_00,
    maxHourlyRateMinor: 10_000_00,
  },
  'policy.cancellation': { fullRefundHours: 24, partialRefundHours: 4, partialRefundPercent: 50 },
  'policy.reschedule': { minHoursBefore: 12, maxReschedules: 2 },
  'notifications.reminders': { offsetsMinutes: [1440, 60], adminAlertEmail: null },
  'features.flags': {
    studentRegistration: true,
    teacherRegistration: true,
    googleCalendarSync: true,
    meetCreation: true,
    teacherSelfPricing: true,
    maintenanceBanner: null,
  },
};

export const settingDescriptions: Record<SettingKey, string> = {
  'booking.rules': 'Checkout hold length, calendar slot granularity and permitted session lengths',
  'pricing.rules': 'Platform fee, tax and teacher rate bounds (basis points, minor units)',
  'policy.cancellation': 'Refund windows for student cancellations',
  'policy.reschedule': 'Reschedule notice and limits',
  'notifications.reminders': 'Reminder offsets before a session and the admin alert inbox',
  'features.flags': 'Feature flags and maintenance banner',
};
