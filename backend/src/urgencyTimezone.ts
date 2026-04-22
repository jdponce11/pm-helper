/** Server-wide zone for “due today” / urgent views (see docker-compose URGENCY_TIMEZONE). */
export function getUrgencyTimezone(): string {
  return process.env.URGENCY_TIMEZONE?.trim() || "UTC";
}
