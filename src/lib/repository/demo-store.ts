/**
 * LOCAL DEMO STATE — browser-only, not secure, not financial storage.
 * Kept behind this module so a real backend repository can replace it.
 */
import { useSyncExternalStore } from "react";
import { createSeed, type DemoSeed } from "@/data/demo-seed";
import type { Role } from "@/types/domain";

export interface DemoState extends DemoSeed {
  role: Role;
  currentUserId: string;
}

const KEY = "luxe-retail-os.demo.v1";
const initial = (): DemoState => ({ ...createSeed(), role: "owner", currentUserId: "emp_owner" });

const serverState = initial();
let state: DemoState = serverState;
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function getState() {
  return state;
}

export function mutate(fn: (draft: DemoState) => void) {
  const draft = structuredClone(state);
  fn(draft);
  state = draft;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: state stays in memory */
  }
  emit();
}

/**
 * Upgrades demo data saved by an older version of the app.
 * - Products without a minimum get minimum = normal price: sales at the listed price still work,
 *   no reductions are possible until the owner sets a minimum, and no lower price is invented.
 * - Older sale lines were always charged the list price, so listPrice = unitPrice is exact;
 *   their minimum at time of sale is unknown and stays undefined.
 */
export function migrateDemoState(stored: DemoState): DemoState {
  for (const p of stored.products) p.minimumSellingPrice ??= p.price;
  for (const sale of stored.sales)
    for (const i of sale.items) {
      i.listPrice ??= i.unitPrice;
      i.lineDiscount ??= 0;
    }
  return stored;
}

export function hydrateDemoState() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      state = migrateDemoState(JSON.parse(raw) as DemoState);
      emit();
    }
  } catch {
    /* ignore corrupt local demo state */
  }
}

export function resetDemoState() {
  localStorage.removeItem(KEY);
  state = initial();
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Returns the whole demo state (stable reference). Derive with useMemo. */
export function useDemoState() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => serverState,
  );
}

export function useRole() {
  const s = useDemoState();
  return { role: s.role, userId: s.currentUserId, isOwner: s.role === "owner" };
}
