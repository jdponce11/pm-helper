import type { ActionFlag } from "../types";

const styles: Record<ActionFlag, { label: string; className: string }> = {
  PASSIVE_MONITOR: {
    label: "Passive monitor",
    className: "badge badge--passive",
  },
  OPTIMIZATION_NEEDED: {
    label: "Optimization",
    className: "badge badge--optimization",
  },
  ACTION_PENDING: {
    label: "Action pending",
    className: "badge badge--pending",
  },
  CRITICAL_BLOCKER: {
    label: "Critical blocker",
    className: "badge badge--critical",
  },
};

export function ActionFlagBadge({ value }: { value: ActionFlag }) {
  const s = styles[value];
  return (
    <span className={s.className} title={value}>
      {s.label}
    </span>
  );
}
