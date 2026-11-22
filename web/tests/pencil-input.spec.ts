import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resetPreferences } from "./preferences-fixture";
import { morePenSettings, showControls } from "./reader-controls";

// Synthetic WebKit stylus streams exercise event ordering and cancellation.
// Playwright cannot emulate physical Apple Pencil hardware or iPadOS Scribble.
async function touch(
  target: Locator,
  type: string,
  x = 0.3,
  y = 0.3,
  kind = "stylus",
  force = 0.001,
) {
  return target.evaluate(
    (element, args) => {
      const bounds = element.getBoundingClientRect();
      const sample = {
        identifier: 41,
        target: element,
        touchType: args.kind,
        clientX: bounds.x + bounds.width * args.x,
        clientY: bounds.y + bounds.height * args.y,
        screenX: bounds.x + bounds.width * args.x,
        screenY: bounds.y + bounds.height * args.y,
        force: args.force,
      };
      const event = new Event(args.type, { bubbles: true, cancelable: true });
      const ended = args.type === "touchend" || args.type === "touchcancel";
      Object.defineProperties(event, {
        changedTouches: { value: [sample] },
        touches: { value: ended ? [] : [sample] },
        targetTouches: { value: ended ? [] : [sample] },
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    },
    { type, x, y, kind, force },
  );
}

async function pencilStroke(page: Page, y = 0.3) {
  const layer = page.locator(".pdf-ink-layer");
  expect(await touch(layer, "touchstart", 0.2, y)).toBe(true);
  for (let i = 1; i <= 8; i++)
    await touch(layer, "touchmove", 0.2 + i * 0.05, y + Math.sin(i) * 0.01);
  expect(await touch(layer, "touchend", 0.65, y, "stylus", 0)).toBe(true);
}

test.beforeEach(async ({ page, request }) => {
  await resetPreferences(request);
  for (const book of await (await request.get("/api/v1/books")).json())
    await request.delete(`/api/v1/books/${book.id}`);
  const response = await request.post("/api/v1/books", {
    multipart: {
      file: {
        name: "pencil.pdf",
        mimeType: "application/pdf",
        buffer: await readFile("tests/fixtures/reading-notes.pdf"),
      },
    },
  });
  expect(response.ok()).toBe(true);
  await page.goto("/");
  await page.getByRole("button", { name: "Read pencil", exact: true }).click();
  await expect(page.locator(".reader-loading")).toHaveCount(0);
  await expect(page.locator(".ink-save-state")).toHaveText("Ink saved");
  await page.getByRole("button", { name: "Draw on PDF", exact: true }).click();
});

test("Pencil touch samples recover missing pointer events, preserve light pressure, and save once per stroke", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await pencilStroke(page);
  await pencilStroke(page, 0.45);
  await expect(page.locator(".ink-stroke")).toHaveCount(2);
  const paths = await page.locator(".ink-stroke").evaluateAll((elements) =>
    elements.map((element) => {
      const box = (element as SVGPathElement).getBBox();
      return {
        width: box.width,
        height: box.height,
        path: element.getAttribute("d"),
      };
    }),
  );
  for (const path of paths) {
    expect(path.width).toBeGreaterThan(100);
    expect(path.height).toBeGreaterThan(1);
    expect(path.path).not.toMatch(/NaN|Infinity/);
  }
  await expect(page.locator(".ink-save-state")).toHaveText("Ink saved");
  const [book] = await (await request.get("/api/v1/books")).json();
  const ink = await (
    await request.get(`/api/v1/books/${book.id}/ink/1`)
  ).json();
  expect(ink.strokes).toHaveLength(2);
  expect(ink.strokes[0].points).toHaveLength(10);
  expect(ink.strokes[0].points[0].pressure).toBeCloseTo(0.001);
  await showControls(page);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Read pencil", exact: true }).click();
  await expect(page.locator(".ink-stroke")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("interleaved pointer/touch events make one stroke and survive pointer cancellation", async ({
  page,
}) => {
  const layer = page.locator(".pdf-ink-layer");
  const box = (await layer.boundingBox())!;
  const pointer = {
    pointerId: 7,
    pointerType: "pen",
    button: 0,
    buttons: 1,
    clientX: box.x + box.width * 0.2,
    clientY: box.y + box.height * 0.3,
    pressure: 0.001,
  };
  await layer.dispatchEvent("pointerdown", pointer);
  await touch(layer, "touchstart", 0.2);
  await layer.dispatchEvent("pointermove", {
    ...pointer,
    clientX: box.x + box.width * 0.3,
  });
  await touch(layer, "touchmove", 0.3);
  await layer.dispatchEvent("pointercancel", pointer);
  await layer.dispatchEvent("lostpointercapture", pointer);
  await touch(layer, "touchmove", 0.55);
  await touch(layer, "touchend", 0.7);
  await layer.dispatchEvent("pointerup", { ...pointer, buttons: 0 });
  await expect(page.locator(".ink-stroke")).toHaveCount(1);
  const width = await page
    .locator(".ink-stroke")
    .evaluate((el) => (el as SVGPathElement).getBBox().width);
  expect(width).toBeGreaterThan(250);
  // The other end-event order must also commit only once.
  await layer.dispatchEvent("pointerdown", { ...pointer, pointerId: 8 });
  await touch(layer, "touchstart", 0.2);
  await touch(layer, "touchmove", 0.5);
  await layer.dispatchEvent("pointerup", {
    ...pointer,
    pointerId: 8,
    buttons: 0,
    clientX: box.x + box.width * 0.7,
  });
  await touch(layer, "touchend", 0.7);
  await expect(page.locator(".ink-stroke")).toHaveCount(2);
});

test("cancelled touch strokes and focus loss leave no ink; finger gestures stay native", async ({
  page,
}) => {
  const layer = page.locator(".pdf-ink-layer");
  expect(await touch(layer, "touchstart", 0.2, 0.3, "direct")).toBe(false);
  await touch(layer, "touchmove", 0.6, 0.3, "direct");
  await touch(layer, "touchend", 0.6, 0.3, "direct");
  await expect(page.locator(".ink-stroke")).toHaveCount(0);
  await touch(layer, "touchstart");
  await touch(layer, "touchmove", 0.5);
  await touch(layer, "touchcancel", 0.6);
  await expect(page.locator(".ink-draft")).toHaveAttribute("d", "");
  await touch(layer, "touchstart");
  await touch(layer, "touchmove", 0.5);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await touch(layer, "touchend", 0.6);
  await expect(page.locator(".ink-stroke")).toHaveCount(0);
  await pencilStroke(page);
  await expect(page.locator(".ink-stroke")).toHaveCount(1);
  // A fast horizontal Pencil stroke must not be interpreted as a page swipe.
  await expect(page.locator(".textLayer")).toContainText("page 1");
});

test("Pencil taps activate controls once, while fingers, keyboard and native inputs work", async ({
  page,
}) => {
  await showControls(page);
  const options = page.getByRole("button", {
    name: "Pen options",
    exact: true,
  });
  expect(await touch(options, "touchstart", 0.5, 0.5)).toBe(true);
  expect(await touch(options, "touchend", 0.5, 0.5)).toBe(true);
  const dialog = page.getByRole("dialog", { name: "Pen options", exact: true });
  await expect(dialog).toBeVisible();
  // Some WebKit versions still dispatch a compatibility click after touchend.
  await options.dispatchEvent("click", { detail: 1 });
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Close pen options" }).click();
  // A finger can use the same button immediately after the Pencil.
  expect(await touch(options, "touchstart", 0.5, 0.5, "direct")).toBe(false);
  await touch(options, "touchend", 0.5, 0.5, "direct");
  await options.click();
  await expect(dialog).toBeVisible();
  await morePenSettings(page);
  const input = page.getByRole("checkbox", { name: "Finger drawing" });
  expect(await touch(input, "touchstart", 0.5, 0.5)).toBe(false);
  expect(await touch(input, "touchend", 0.5, 0.5)).toBe(false);
  await input.check();
  await expect(input).toBeChecked();
  await page.getByRole("button", { name: "Close pen options" }).click();
  await options.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Close pen options" }).click();
  // Sliding off the button or cancellation must not activate it.
  await touch(options, "touchstart", 0.5, 0.5);
  await touch(options, "touchmove", 3, 0.5);
  await touch(options, "touchend", 0.5, 0.5);
  await expect(dialog).not.toBeVisible();
  await touch(options, "touchstart", 0.5, 0.5);
  await touch(options, "touchcancel", 0.5, 0.5);
  await expect(dialog).not.toBeVisible();
});

test("native pointer samples survive missing or throwing coalescing APIs and ignore stale samples", async ({
  page,
  request,
}) => {
  await page.locator(".pdf-ink-layer").evaluate((layer) => {
    const box = layer.getBoundingClientRect();
    for (const mode of ["missing", "throws", "stale"]) {
      const base = {
        pointerId: 12,
        pointerType: "pen",
        button: 0,
        buttons: 1,
        bubbles: true,
        clientY: box.y + box.height * 0.3,
        pressure: 0,
      };
      const down = new PointerEvent("pointerdown", {
        ...base,
        clientX: box.x + box.width * 0.2,
      });
      Object.defineProperty(down, "timeStamp", { value: 1 });
      layer.dispatchEvent(down);
      for (let i = 1; i <= 5; i++) {
        const event = new PointerEvent("pointermove", {
          ...base,
          clientX: box.x + box.width * (0.2 + i * 0.1),
        });
        Object.defineProperty(event, "timeStamp", { value: i + 1 });
        Object.defineProperty(event, "getCoalescedEvents", {
          value:
            mode === "missing"
              ? undefined
              : () => {
                  if (mode === "throws") throw new Error("Unavailable");
                  return [down];
                },
        });
        layer.dispatchEvent(event);
      }
      layer.dispatchEvent(
        new PointerEvent("pointerup", {
          ...base,
          buttons: 0,
          clientX: box.x + box.width * 0.7,
        }),
      );
    }
  });
  await expect(page.locator(".ink-stroke")).toHaveCount(3);
  for (const stroke of await page.locator(".ink-stroke").all())
    expect(await stroke.getAttribute("d")).not.toMatch(/NaN|Infinity/);
  await expect(page.locator(".ink-save-state")).toHaveText("Ink saved");
  const [book] = await (await request.get("/api/v1/books")).json();
  const ink = await (
    await request.get(`/api/v1/books/${book.id}/ink/1`)
  ).json();
  for (const stroke of ink.strokes) {
    expect(stroke.points).toHaveLength(6);
    for (let i = 1; i < stroke.points.length; i++)
      expect(stroke.points[i].x).toBeGreaterThan(stroke.points[i - 1].x);
  }
});
