/**
 * Pure picker-menu logic for /rs. No pi SDK dependency.
 *
 * ctx.ui.select() returns the chosen STRING, so every menu item must be
 * unique — otherwise resolving the string back to an index picks the wrong
 * session (first duplicate wins). uniquify() guarantees uniqueness.
 */

export const LOAD_MORE_PREFIX = "▼ Load more...";
export const SHOW_TIER_PREFIX = "▼ Show ";

export type PickerAction =
  | { kind: "entry"; index: number }
  | { kind: "more" }
  | { kind: "tier" }
  | { kind: "cancel" };

/** Make labels unique by suffixing duplicates with ` (2)`, ` (3)`, … */
export function uniquify(labels: string[]): string[] {
  const seen = new Map<string, number>();
  return labels.map((label) => {
    const count = (seen.get(label) ?? 0) + 1;
    seen.set(label, count);
    return count === 1 ? label : `${label} (${count})`;
  });
}

/** Build the full item list: unique entry rows + optional action rows. */
export function buildPickerItems(
  entryLabels: string[],
  opts: { remaining?: number; nextTierLabel?: string } = {},
): string[] {
  const items = uniquify(entryLabels);
  if (opts.remaining !== undefined) {
    items.push(`${LOAD_MORE_PREFIX} (${opts.remaining} remaining)`);
  }
  if (opts.nextTierLabel !== undefined) {
    items.push(`${SHOW_TIER_PREFIX}${opts.nextTierLabel}`);
  }
  return items;
}

/** Resolve a select() result back to an action. */
export function resolveChoice(
  items: string[],
  choice: string | undefined | null,
  entryCount: number,
): PickerAction {
  if (choice === undefined || choice === null) return { kind: "cancel" };

  const index = items.indexOf(choice);
  if (index >= 0 && index < entryCount) return { kind: "entry", index };

  if (choice.startsWith(LOAD_MORE_PREFIX)) return { kind: "more" };
  if (choice.startsWith(SHOW_TIER_PREFIX)) return { kind: "tier" };

  return { kind: "cancel" };
}
