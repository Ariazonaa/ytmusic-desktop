import { afterEach, describe, expect, it } from "vitest";
import { waitForElement } from "./dom";

afterEach(() => {
  document.body.replaceChildren();
});

describe("waitForElement", () => {
  it("resolves immediately when the element exists", async () => {
    const nav = document.body.appendChild(document.createElement("nav"));
    await expect(waitForElement("nav")).resolves.toBe(nav);
  });

  it("waits for an element that is added later, even nested", async () => {
    const pending = waitForElement(".late");
    const wrapper = document.createElement("div");
    const late = wrapper.appendChild(document.createElement("span"));
    late.className = "late";
    document.body.appendChild(wrapper);
    await expect(pending).resolves.toBe(late);
  });
});
