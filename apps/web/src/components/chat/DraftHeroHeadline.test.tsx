import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { DraftHeroHeadline } from "./DraftHeroHeadline";

describe("DraftHeroHeadline", () => {
  it("does not ask standalone chats to choose a project", () => {
    const markup = renderToStaticMarkup(
      <DraftHeroHeadline activeProjectRef={null} activeProjectTitle={null} isStandalone />,
    );

    expect(markup).toContain("What can I help you with?");
    expect(markup).not.toContain("Choose a project");
  });
});
