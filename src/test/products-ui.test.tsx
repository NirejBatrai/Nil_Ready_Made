import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { must } from "@/lib/assert";
import { repo } from "@/lib/repository";
import { resetDemoState } from "@/lib/repository/demo-store";
import { Route } from "@/routes/_shell.products";

describe("Products screen", () => {
  it("shows employees the owner-only lock instead of pricing controls (UI gate only)", () => {
    repo.setDemoRole("employee");
    const Page = must(Route.options.component);
    const { unmount } = render(<Page />);
    expect(screen.getByText("Owner access required")).toBeInTheDocument();
    expect(screen.queryByText(/Minimum price/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add product/ })).not.toBeInTheDocument();
    unmount(); // before reset switches back to owner, which needs the router
    resetDemoState();
  });
});
