import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SectionEditor } from "../SectionEditor";
import type { LandingSection } from "../../../lib/composeLandingHtml";

vi.mock("../../../lib/api", () => ({
  api: {},
  APIError: class extends Error {},
}));

const hero: LandingSection = {
  id: "hero",
  type: "hero",
  data: {
    variant: "centered",
    headline: "Original headline",
    subheadline: "Original subheadline",
    cta_label: "Join",
    cta_href: "#signup",
  },
};

describe("SectionEditor rich text", () => {
  it("syncs an external update without publishing it as a user edit", async () => {
    const onChange = vi.fn();
    const view = render(
      <SectionEditor sessionId="test" section={hero} onChange={onChange} />,
    );

    expect(await screen.findByText("Original headline")).toBeInTheDocument();

    const updated: LandingSection = {
      ...hero,
      data: { ...hero.data, headline: "Updated headline" },
    };
    view.rerender(
      <SectionEditor sessionId="test" section={updated} onChange={onChange} />,
    );

    expect(await screen.findByText("Updated headline")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
