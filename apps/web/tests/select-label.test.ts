import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Select,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { rulesetSelectItems } from "@/app/admin/leagues/[slug]/seasons/season-dialog";

describe("ruleset select labels", () => {
  it("maps a stored numeric ruleset id to the ruleset name shown in the trigger", () => {
    const items = rulesetSelectItems([
      { id: 1, name: "PCA Classic" },
      { id: 2, name: "RMsolo Summer" },
    ]);

    const html = renderToStaticMarkup(
      createElement(
        Select,
        { items, value: "2" },
        createElement(
          SelectTrigger,
          null,
          createElement(SelectValue),
        ),
      ),
    );

    expect(html).toContain("RMsolo Summer");
    expect(html).not.toMatch(/>2</);
  });
});
