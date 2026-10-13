// Plans and their limits, matching the pricing on the landing page (null = unlimited).
// Payments aren't enabled, so owners can switch plans freely in the admin panel; the
// limits themselves are enforced.
const MB = 1024 * 1024;
const GB = 1024 * MB;

export const PLANS = {
  free: { name: 'Free', members: 5, boards: 3, storageBytes: 100 * MB },
  pro: { name: 'Pro', members: 25, boards: null, storageBytes: 5 * GB },
  team: { name: 'Team', members: null, boards: null, storageBytes: 50 * GB },
};

export const PLAN_KEYS = Object.keys(PLANS);

export const planLimits = (key) => PLANS[key] ?? PLANS.free;

// "100 MB", "5 GB"
export const formatBytes = (bytes) => (bytes >= GB ? `${Math.round(bytes / GB)} GB` : `${Math.round(bytes / MB)} MB`);
