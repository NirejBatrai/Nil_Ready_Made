import { describe, expect, it } from "vitest";
import { createSeed, DEMO_TODAY } from "@/data/demo-seed";
import { dayKey } from "@/lib/format";
import { must } from "@/lib/assert";

describe("demo fixtures", () => {
  it("are identical on every call, so Reset demo restores the original data", () => {
    expect(createSeed()).toEqual(createSeed());
  });

  it("today's drawer opener and its audit event name the same person", () => {
    const s = createSeed();
    const today = must(s.cashSessions.find((c) => dayKey(c.openedAt) === DEMO_TODAY));
    const opened = must(
      s.audit.find((a) => a.action === "cash_session.opened" && a.target === today.id),
    );
    expect(opened.actorId).toBe(today.employeeId);
    expect(opened.at).toBe(today.openedAt);
  });

  it("every drawer open/close audit event matches its session record", () => {
    const s = createSeed();
    for (const c of s.cashSessions) {
      const events = s.audit.filter(
        (a) => a.target === c.id && a.action.startsWith("cash_session."),
      );
      expect(events.map((e) => e.action).sort()).toEqual(
        c.closedAt ? ["cash_session.closed", "cash_session.opened"] : ["cash_session.opened"],
      );
      for (const e of events) expect(e.actorId).toBe(c.employeeId);
    }
  });

  it("cash discrepancy requests are raised by the employee who closed that drawer", () => {
    const s = createSeed();
    for (const a of s.approvals.filter((x) => x.type === "cash_discrepancy")) {
      const c = must(s.cashSessions.find((x) => x.id === a.cashSessionId));
      expect(a.requesterId).toBe(c.employeeId);
      expect(a.amount).toBe(must(c.countedCash) - must(c.expectedAtClose));
    }
  });

  it("drawer sales are taken by the employee who opened that drawer", () => {
    const s = createSeed();
    for (const sale of s.sales.filter((x) => x.cashSessionId)) {
      const c = must(s.cashSessions.find((x) => x.id === sale.cashSessionId));
      expect(sale.employeeId).toBe(c.employeeId);
    }
  });

  it("no employee's last activity is earlier than their latest audited action", () => {
    const s = createSeed();
    for (const e of s.employees)
      for (const a of s.audit.filter((x) => x.actorId === e.id))
        expect(e.lastActiveAt >= a.at).toBe(true);
  });
});
