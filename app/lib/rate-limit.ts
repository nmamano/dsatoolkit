const windowMs = 60 * 60 * 1000; // 1 hour
const maxPerHour = 20;
const maxPerMinute = 5;

const hits = new Map<string, number[]>();

export function rateLimit(ip: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const timestamps = (hits.get(ip) || []).filter((t) => now - t < windowMs);

  const lastMinute = timestamps.filter((t) => now - t < 60 * 1000);
  if (lastMinute.length >= maxPerMinute) {
    return { allowed: false, retryAfterSeconds: 60 };
  }
  if (timestamps.length >= maxPerHour) {
    const oldest = timestamps[0];
    return { allowed: false, retryAfterSeconds: Math.ceil((oldest + windowMs - now) / 1000) };
  }

  timestamps.push(now);
  hits.set(ip, timestamps);
  return { allowed: true };
}
