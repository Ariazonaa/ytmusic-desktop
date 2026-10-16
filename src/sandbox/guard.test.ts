// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { clean, installGuard } from "./guard";

beforeAll(() => {
  installGuard();
});

const link = (): HTMLLinkElement => document.createElement("link");

describe("installGuard", () => {
  it("refuses the elements that could reach the network or bring a fresh window", () => {
    for (const name of ["iframe", "IFRAME", "frame", "object", "embed", "meta"]) {
      expect(() => document.createElement(name), name).toThrow(/not available to plugins/);
    }
    expect(() => document.createElementNS("http://www.w3.org/1999/xhtml", "iframe")).toThrow();
    // The same name in another namespace is a different element.
    expect(document.createElementNS("http://www.w3.org/2000/svg", "link").localName).toBe("link");
    expect("HTMLIFrameElement" in globalThis).toBe(false);
    expect("HTMLLinkElement" in globalThis).toBe(false);
  });

  it("makes a <link> that loads a stylesheet and nothing else", () => {
    const element = link();
    expect(element.rel).toBe("stylesheet");
    element.rel = "Stylesheet ";
    element.setAttribute("rel", "stylesheet");
    const attempts: [string, () => void][] = [
      ["rel", () => (element.rel = "preconnect")],
      ["relList.add", () => element.relList.add("prerender")],
      ["relList.value", () => (element.relList.value = "dns-prefetch")],
      ["relList.replace", () => element.relList.replace("stylesheet", "prefetch")],
      ["relList.toggle", () => element.relList.toggle("preload")],
      ["setAttribute", () => element.setAttribute("REL", "stylesheet preconnect")],
      ["setAttributeNS", () => element.setAttributeNS(null, "rel", "prerender")],
      ["Attr.value", () => (element.getAttributeNode("rel")!.value = "prerender")],
      ["Attr.nodeValue", () => (element.attributes.getNamedItem("rel")!.nodeValue = "prerender")],
      ["Attr.textContent", () => (element.getAttributeNode("rel")!.textContent = "prerender")],
      [
        "setAttributeNode",
        () => {
          const attr = document.createAttribute("rel");
          attr.value = "prerender";
          element.setAttributeNode(attr);
        },
      ],
      [
        "setNamedItem",
        () => {
          const attr = document.createAttribute("rel");
          attr.value = "prerender";
          element.attributes.setNamedItem(attr);
        },
      ],
      [
        "swapped prototype",
        () => {
          Object.setPrototypeOf(element, HTMLElement.prototype);
          Element.prototype.setAttribute.call(element, "rel", "prerender");
        },
      ],
    ];
    for (const [name, attempt] of attempts) expect(attempt, name).toThrow(/not available to plugins/);
    expect(element.getAttribute("rel")).toBe("stylesheet");
  });

  it("leaves other elements' attributes alone", () => {
    const div = document.createElement("div");
    div.setAttribute("rel", "prerender");
    div.getAttributeNode("rel")!.value = "anything";
    div.classList.add("a", "b");
    div.classList.toggle("a");
    expect(div.getAttribute("rel")).toBe("anything");
    expect(div.className).toBe("b");
  });

  it("cannot be undone", () => {
    expect(() => Object.defineProperty(Document.prototype, "createElement", { value: () => null })).toThrow();
    expect(() => {
      "use strict";
      (Element.prototype as { setAttribute: unknown }).setAttribute = () => undefined;
    }).toThrow();
  });
});

describe("clean", () => {
  it("removes what a plugin cannot have, also inside templates", () => {
    const template = document.createElement("template");
    template.innerHTML = [
      '<p>kept <b>bold</b></p>',
      '<link rel="stylesheet" href="style.css">',
      '<link rel="preconnect" href="https://example.com">',
      '<link rel="stylesheet prerender" href="https://example.com">',
      "<iframe></iframe><object></object><embed><meta http-equiv=refresh content=0>",
      '<template><link rel="prerender" href="https://example.com"><i>inner</i></template>',
    ].join("");
    expect(clean(template.content)).toBe(7);
    expect(template.innerHTML).toBe(
      '<p>kept <b>bold</b></p><link rel="stylesheet" href="style.css"><template><i>inner</i></template>',
    );
    expect(clean(template.content)).toBe(0);
  });
});
