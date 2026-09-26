/**
 * Accessibility scan — uses @axe-core/playwright on each route.
 *
 * Install (devDep):
 *   npm i -D @axe-core/playwright
 *
 * Asserts zero serious / critical violations. Color contrast, role/name
 * mismatch, missing labels, etc. are all covered.
 */
import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";

interface AxeViolation {
  id: string;
  impact?: string | null;
  help: string;
  nodes: { target: string[] }[];
}

const ROUTES = [
  { path: "/", name: "home" },
  { path: "/companies", name: "companies" },
  { path: "/billing", name: "billing" },
  { path: "/settings", name: "settings" },
];

test.describe("accessibility", () => {
  for (const route of ROUTES) {
    test(`a11y ${route.name}`, async ({ page, authedUser, signInOnPage }) => {
      await signInOnPage(page, authedUser);
      await page.goto(route.path);
      await page.waitForLoadState("networkidle");

      const builder = new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .disableRules(["region"]); // we use main + nav + complementary deliberately

      const results = await builder.analyze();
      const violations = results.violations as AxeViolation[];
      const serious = violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );

      if (serious.length > 0) {
         
        console.error(
          `[a11y ${route.name}]`,
          serious.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.length })),
        );
      }
      expect(serious).toHaveLength(0);
    });
  }

  test("a11y results view tabs", async ({
    page,
    authedUser,
    signInOnPage,
    seededCompany,
  }) => {
    await signInOnPage(page, authedUser);
    await page.goto(`/results/${seededCompany.session_id}`);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    const violations = (results.violations as AxeViolation[]).filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(violations).toHaveLength(0);
  });
});
