import { describe, expect, it } from "vitest";
import { fallbackCover, largeCover } from "./size";

describe("largeCover", () => {
  it("asks the image servers for the large size", () => {
    expect(largeCover("https://lh3.googleusercontent.com/AbC_d-1=w60-h60-l90-rj")).toBe(
      "https://lh3.googleusercontent.com/AbC_d-1=w1200-h1200-l90-rj",
    );
    expect(largeCover("https://yt3.ggpht.com/xyz=s88-c-k")).toBe("https://yt3.ggpht.com/xyz=w1200-h1200-l90-rj");
    expect(largeCover("https://lh3.googleusercontent.com/no-size")).toBe(
      "https://lh3.googleusercontent.com/no-size=w1200-h1200-l90-rj",
    );
  });

  it("takes the largest picture of a video, with a smaller one to fall back to", () => {
    const large = largeCover("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg?sqp=abc");
    expect(large).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg");
    expect(fallbackCover(large)).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(largeCover("https://i.ytimg.com/vi_webp/dQw4w9WgXcQ/sddefault.webp")).toBe(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
    );
  });

  it("leaves what it does not know alone", () => {
    expect(largeCover("https://example.org/cover.jpg")).toBe("https://example.org/cover.jpg");
    expect(largeCover("not a url")).toBe("not a url");
    expect(fallbackCover("https://lh3.googleusercontent.com/x=w1200")).toBeNull();
  });
});
