import { afterEach, describe, expect, it, vi } from "vitest";
import { correctDisplay, formatTime, withElapsed } from "./display";

describe("formatTime", () => {
  it("writes minutes and seconds", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(66.9)).toBe("1:06");
    expect(formatTime(599)).toBe("9:59");
    expect(formatTime(-3)).toBe("0:00");
  });

  it("adds hours from an hour on", () => {
    expect(formatTime(3600)).toBe("1:00:00");
    expect(formatTime(3725)).toBe("1:02:05");
  });
});

describe("withElapsed", () => {
  it("replaces only the elapsed part", () => {
    expect(withElapsed("1:06 / 3:34", 62)).toBe("1:02 / 3:34");
    expect(withElapsed("\n  1:00:10 / 1:20:00\n", 3605)).toBe("\n  1:00:05 / 1:20:00\n");
  });

  it("leaves other texts alone", () => {
    expect(withElapsed("", 5)).toBe("");
    expect(withElapsed("LIVE", 5)).toBe("LIVE");
    expect(withElapsed("3:34", 5)).toBe("3:34");
  });
});

describe("correctDisplay", () => {
  function addPlayerBar(text: string, value: number) {
    const bar = document.body.appendChild(document.createElement("ytmusic-player-bar"));
    const time = bar.appendChild(document.createElement("span"));
    time.className = "time-info";
    time.textContent = text;
    const slider = Object.assign(bar.appendChild(document.createElement("div")), { id: "progress-bar", value });
    return { time, slider: slider as typeof slider & { dragging?: boolean } };
  }
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    document.body.replaceChildren();
  });

  it("rewrites the display when the page updates it", async () => {
    const { time, slider } = addPlayerBar("0:00 / 3:34", 0);
    stop = correctDisplay(() => ({ position: 62, ahead: 4 }));

    // The page reports the player's position, which is ahead.
    time.textContent = "1:06 / 3:34";
    slider.value = 66;

    await vi.waitFor(() => expect(time.textContent).toBe("1:02 / 3:34"));
    expect(slider.value).toBe(62);
  });

  it("keeps the page's own text node, so the page can go on updating it", async () => {
    const { time } = addPlayerBar("0:00 / 3:34", 0);
    const pageNode = time.firstChild as Text;
    stop = correctDisplay(() => ({ position: 62, ahead: 4 }));

    pageNode.data = "1:06 / 3:34";

    await vi.waitFor(() => expect(pageNode.data).toBe("1:02 / 3:34"));
    expect(time.firstChild).toBe(pageNode);
    expect(time.childNodes).toHaveLength(1);
  });

  it("leaves the display alone while the player is not ahead", async () => {
    const { time, slider } = addPlayerBar("0:00 / 3:34", 0);
    stop = correctDisplay(() => ({ position: 66, ahead: 0.1 }));
    time.textContent = "1:06 / 3:34";
    slider.value = 66;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(time.textContent).toBe("1:06 / 3:34");
    expect(slider.value).toBe(66);
  });

  it("does not move the bar while the user drags it", async () => {
    const { time, slider } = addPlayerBar("0:00 / 3:34", 0);
    slider.dragging = true;
    stop = correctDisplay(() => ({ position: 62, ahead: 4 }));
    time.textContent = "1:06 / 3:34";
    slider.value = 150;
    await vi.waitFor(() => expect(time.textContent).toBe("1:02 / 3:34"));
    expect(slider.value).toBe(150);
  });

  it("stops when asked to", async () => {
    const { time } = addPlayerBar("0:00 / 3:34", 0);
    correctDisplay(() => ({ position: 62, ahead: 4 }))();
    time.textContent = "1:06 / 3:34";
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(time.textContent).toBe("1:06 / 3:34");
  });
});
