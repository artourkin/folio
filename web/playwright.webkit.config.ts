import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig(base, {
  testMatch: "pencil-input.spec.ts",
  use: {
    browserName: "webkit",
    launchOptions: {},
    viewport: { width: 1024, height: 768 },
    isMobile: true,
    hasTouch: true,
  },
});
