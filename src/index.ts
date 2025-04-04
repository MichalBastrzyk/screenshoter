#!/usr/bin/env bun
import { Command } from "commander";
import { chromium, type Browser, type Page } from "playwright";
import fs from "fs";
import path from "path";

type DeviceType = "desktop" | "mobile";
type WaitCondition = "load" | "domcontentloaded" | "networkidle" | "commit";

interface ScreenshotOptions {
  url: string;
  selectors?: string[];
  config?: string;
  wait: number;
  animationTrigger: boolean;
  output: string;
  navigationTimeout: number;
  waitCondition: WaitCondition;
  parentSelector?: string;
  device?: DeviceType | "both";
}

interface ViewportConfig {
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
}

class DeviceConfigs {
  private static readonly configs: Record<DeviceType, ViewportConfig> = {
    desktop: {
      width: 1500,
      height: 1095,
      deviceScaleFactor: 1,
      isMobile: false,
    },
    mobile: {
      width: 430,
      height: 932,
      deviceScaleFactor: 2,
      isMobile: true,
    },
  };

  static getConfig(deviceType: DeviceType): ViewportConfig {
    return this.configs[deviceType];
  }

  static getMobileUserAgent(): string {
    return "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1";
  }
}

class SelectorManager {
  constructor(private page: Page, private options: ScreenshotOptions) {}

  async getSelectors(): Promise<string[]> {
    let selectors = this.loadSelectorsFromConfig();

    if (this.options.parentSelector) {
      const childSelectors = await this.getChildSelectors();
      const uniqueSelectors = new Set([...selectors, ...childSelectors]);
      selectors = Array.from(uniqueSelectors);
    }

    return selectors;
  }

  private loadSelectorsFromConfig(): string[] {
    if (this.options.config) {
      try {
        const configData = fs.readFileSync(this.options.config, "utf8");
        const config = JSON.parse(configData);
        return config.selectors || [];
      } catch (error) {
        console.error(`Error reading config file: ${error}`);
        return [];
      }
    }
    return this.options.selectors || [];
  }

  private async getChildSelectors(): Promise<string[]> {
    if (!this.options.parentSelector) {
      return [];
    }
    console.log(
      `Finding children of parent selector: ${this.options.parentSelector}`
    );
    return await this.page.evaluate((parentSelector: string) => {
      const parent = document.querySelector(parentSelector);
      if (!parent) return [];

      const children = Array.from(parent.children);
      return children.map((child, index) => {
        const safeIndex = `screenshot-target-${index}`;
        child.setAttribute("data-screenshot", safeIndex);
        return `[data-screenshot="${safeIndex}"]`;
      });
    }, this.options.parentSelector);
  }

  async makeSelectorSafe(selector: string): Promise<string> {
    if (selector.startsWith("[data-screenshot")) {
      return selector;
    }

    return await this.page.evaluate((sel) => {
      const element = document.querySelector(sel);
      if (!element) {
        throw new Error(`Element not found: ${sel}`);
      }

      const safeId = `screenshot-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`;
      element.setAttribute("data-screenshot", safeId);
      return `[data-screenshot="${safeId}"]`;
    }, selector);
  }
}

class AnimationHandler {
  constructor(private page: Page) {}

  async triggerAnimation(selector: string): Promise<void> {
    await this.centerElement(selector);
    await this.page.waitForTimeout(500);
    await this.adjustPosition(selector);
    await this.page.waitForTimeout(200);
  }

  private async centerElement(selector: string): Promise<void> {
    await this.page.evaluate((sel) => {
      const element = document.querySelector(sel);
      if (element) {
        const rect = element.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const elementHeight = rect.height;
        const targetScrollY = Math.max(
          0,
          window.pageYOffset + rect.top - (viewportHeight - elementHeight) / 2
        );
        window.scrollTo({ top: targetScrollY, behavior: "smooth" });
      }
    }, selector);
  }

  private async adjustPosition(selector: string): Promise<void> {
    await this.page.evaluate((sel) => {
      const element = document.querySelector(sel);
      if (element) {
        const rect = element.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const elementCenter = rect.top + rect.height / 2;
        const viewportCenter = viewportHeight / 2;
        const offset = Math.abs(elementCenter - viewportCenter);

        if (offset > 50) {
          const adjustment = elementCenter - viewportCenter;
          window.scrollBy({ top: adjustment, behavior: "instant" });
        }
      }
    }, selector);
  }
}

class ScreenshotCapture {
  private browser: Browser | null = null;

  constructor(private options: ScreenshotOptions) {}

  async start(): Promise<void> {
    this.browser = await chromium.launch();

    try {
      const deviceTypes = this.getDeviceTypes();
      for (const deviceType of deviceTypes) {
        await this.processDevice(deviceType);
      }
    } catch (error) {
      this.handleError(error);
    } finally {
      await this.cleanup();
    }
  }

  private getDeviceTypes(): DeviceType[] {
    return this.options.device === "both"
      ? ["desktop", "mobile"]
      : [this.options.device as DeviceType];
  }

  private async processDevice(deviceType: DeviceType): Promise<void> {
    console.log(`\nProcessing ${deviceType} screenshots...`);
    const context = await this.createBrowserContext(deviceType);
    const page = await this.setupPage(context);

    const selectorManager = new SelectorManager(page, this.options);
    const animationHandler = new AnimationHandler(page);

    const selectors = await selectorManager.getSelectors();
    this.ensureOutputDirectory();

    for (const selector of selectors) {
      await this.processSelector(
        selector,
        deviceType,
        page,
        selectorManager,
        animationHandler
      );
    }

    await context.close();
  }

  private async createBrowserContext(deviceType: DeviceType) {
    if (!this.browser) throw new Error("Browser not initialized");

    const viewportConfig = DeviceConfigs.getConfig(deviceType);
    return await this.browser.newContext({
      viewport: viewportConfig,
      deviceScaleFactor: viewportConfig.deviceScaleFactor,
      isMobile: viewportConfig.isMobile,
      userAgent: viewportConfig.isMobile
        ? DeviceConfigs.getMobileUserAgent()
        : undefined,
    });
  }

  private async setupPage(context: any): Promise<Page> {
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(this.options.navigationTimeout);

    console.log(
      `Navigating to ${this.options.url} with timeout ${this.options.navigationTimeout}ms...`
    );
    await page.goto(this.options.url, {
      waitUntil: this.options.waitCondition,
    });
    console.log("Page loaded successfully");

    return page;
  }

  private ensureOutputDirectory(): void {
    if (!fs.existsSync(this.options.output)) {
      fs.mkdirSync(this.options.output, { recursive: true });
    }
  }

  private async processSelector(
    selector: string,
    deviceType: DeviceType,
    page: Page,
    selectorManager: SelectorManager,
    animationHandler: AnimationHandler
  ): Promise<void> {
    console.log(`Processing selector: ${selector}`);

    try {
      const safeSelector = await selectorManager.makeSelectorSafe(selector);

      if (this.options.animationTrigger) {
        console.log(`Triggering animations for: ${safeSelector}`);
        await animationHandler.triggerAnimation(safeSelector);
      }

      console.log(
        `Waiting ${this.options.wait}ms for animations to complete...`
      );
      await page.waitForTimeout(this.options.wait);

      const filename = this.generateFilename(selector, deviceType);
      const filepath = path.join(this.options.output, filename);

      await page.screenshot({
        path: filepath,
        fullPage: false,
      });

      console.log(`Screenshot saved: ${filepath}`);
    } catch (error) {
      console.error(`Error processing selector "${selector}":`, error);
    }
  }

  private generateFilename(selector: string, device: DeviceType): string {
    const cleanSelector = selector
      .replace(/[#.]/g, "")
      .replace(/[^a-z0-9]/gi, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .toLowerCase();

    return `${cleanSelector}__${device}.png`;
  }

  private handleError(error: unknown): void {
    console.error("Error capturing screenshots:", error);
    if (error instanceof Error) {
      console.error(`Error message: ${error.message}`);
      console.error(`Error stack: ${error.stack}`);
    }
  }

  private async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

function parseCommandLineOptions(): ScreenshotOptions {
  const program = new Command();
  program
    .name("section-shot")
    .description("Take screenshots of website sections with animation support")
    .version("1.0.0")
    .requiredOption("-u, --url <url>", "Website URL to screenshot")
    .option(
      "-s, --selectors <selectors...>",
      "CSS selectors for sections to capture"
    )
    .option(
      "-p, --parent-selector <selector>",
      "Parent selector to capture all children"
    )
    .option("-c, --config <path>", "Path to config file")
    .option("-w, --wait <ms>", "Wait time for animations in ms", "1000")
    .option(
      "-a, --animation-trigger",
      "Trigger scroll animations before capture",
      false
    )
    .option("-o, --output <directory>", "Output directory", "./screenshots")
    .option(
      "-t, --navigation-timeout <ms>",
      "Navigation timeout in ms",
      "60000"
    )
    .option(
      "--wait-condition <condition>",
      "Page load wait condition: load, domcontentloaded, networkidle, commit",
      "domcontentloaded"
    )
    .option(
      "-d, --device <type>",
      "Device type to capture: desktop, mobile, or both",
      "both"
    )
    .parse(process.argv);

  const options = program.opts();
  return {
    ...options,
    url: options.url,
    wait: parseInt(options.wait),
    navigationTimeout: parseInt(options.navigationTimeout),
    waitCondition: options.waitCondition as WaitCondition,
    animationTrigger: options.animationTrigger || false,
    output: options.output || "./screenshots",
  };
}

async function main() {
  const options = parseCommandLineOptions();
  const screenshotCapture = new ScreenshotCapture(options);
  await screenshotCapture.start();
}

main().catch(console.error);
