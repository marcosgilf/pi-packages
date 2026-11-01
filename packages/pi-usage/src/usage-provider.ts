export type UsageState = "available" | "unavailable" | "expired" | "unsupported" | "stale";

export type UsageWindowIdentity =
  | { limitId: string; durationMs?: number }
  | { limitId?: undefined; durationMs: number };

export type UsageWindow = UsageWindowIdentity & {
  label?: string;
  used?: number;
  limit?: number;
  remaining?: number;
  usedPercent?: number;
  unit?: string;
  /** Unix timestamp in milliseconds. */
  resetsAt?: number;
  unlimited?: boolean;
};

export type UsageSnapshot = {
  providerId: string;
  /** Non-secret provider account or workspace identity. */
  accountId?: string;
  authMethod?: string;
  plan?: string;
  windows: UsageWindow[];
  /** Unix timestamp in milliseconds. */
  fetchedAt: number;
  state: UsageState;
  /** Sanitized, user-safe error. Never include credentials. */
  error?: string;
};

export type UsageProvider = {
  id: string;
  fetchUsage(options?: { signal?: AbortSignal }): Promise<UsageSnapshot>;
};
