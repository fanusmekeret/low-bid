import { prisma } from "../../lib/prisma.js";

/** Platform defaults (decisions of 7 Nov 2026). Overridden by rows in system_settings. */
export const DEFAULT_SETTINGS = {
  seller_commission_bps: 1000, // 10% platform fee, taken from the seller
  buyer_premium_bps: 0,
  anti_sniping_window_sec: 120,
  anti_sniping_max_extensions: 15,
  payment_timeout_hours: 48,
  fallback_to_next_bidder: true,
  bid_rate_limit_per_10s: 10,
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;

export async function getSetting<K extends SettingKey>(key: K): Promise<(typeof DEFAULT_SETTINGS)[K]> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return (row?.value as (typeof DEFAULT_SETTINGS)[K] | undefined) ?? DEFAULT_SETTINGS[key];
}
