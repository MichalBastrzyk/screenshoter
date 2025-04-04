#!/usr/bin/env bun
import { Command } from "commander";
import {
  chromium,
  type Browser,
  type Page,
  type ElementHandle,
} from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// For ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type DeviceType = "desktop" | "mobile";

interface CliOptions {
  url: string;
  selectors?: string[];
  config?: string;
  wait: string;
  animationTrigger: boolean;
  output: string;
  navigationTimeout: string;
  waitCondition: "load" | "domcontentloaded" | "networkidle" | "commit";
  parentSelector?: string;
  device?: DeviceType | "both";
}

interface ConfigFile {
  selectors: string[];
  [key: string]: any;
}

interface ViewportConfig {
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
}

const VIEWPORT_CONFIGS: Record<"desktop" | "mobile", ViewportConfig> = {
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
  .option("-a, --animation-trigger", "Trigger scroll animations before capture")
  .option("-o, --output <directory>", "Output directory", "./screenshots")
  .option("-t, --navigation-timeout <ms>", "Navigation timeout in ms", "60000")
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

const options = program.opts() as CliOptions;

async function captureScreenshots(): Promise<void> {
  const browser: Browser = await chromium.launch();

  try {
    const deviceTypes: DeviceType[] =
      options.device === "both"
        ? ["desktop", "mobile"]
        : [options.device as DeviceType];

    let selectors = getSelectors(options);

    for (const deviceType of deviceTypes) {
      console.log(`\nProcessing ${deviceType} screenshots...`);

      const viewportConfig = VIEWPORT_CONFIGS[deviceType];

      const context = await browser.newContext({
        viewport: viewportConfig,
        deviceScaleFactor: viewportConfig.deviceScaleFactor,
        isMobile: viewportConfig.isMobile,
        userAgent: viewportConfig.isMobile
          ? "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1"
          : undefined,
      });

      const page = await context.newPage();
      page.setDefaultNavigationTimeout(parseInt(options.navigationTimeout));

      console.log(
        `Navigating to ${options.url} with timeout ${options.navigationTimeout}ms...`
      );
      await page.goto(options.url, { waitUntil: options.waitCondition as any });
      console.log("Page loaded successfully");

      // If parent selector is provided, get all its children
      if (options.parentSelector) {
        console.log(
          `Finding children of parent selector: ${options.parentSelector}`
        );
        const childSelectors = await page.evaluate((parentSelector) => {
          const parent = document.querySelector(parentSelector);
          if (!parent) return [];

          const children = Array.from(parent.children);
          return children.map((child, index) => {
            // Add a unique data attribute to each child
            const safeIndex = `screenshot-target-${index}`;
            child.setAttribute("data-screenshot", safeIndex);
            return `[data-screenshot="${safeIndex}"]`;
          });
        }, options.parentSelector);

        console.log(
          `Found ${childSelectors.length} children under parent selector`
        );
        // Create a Set to ensure unique selectors
        const uniqueSelectors = new Set([...selectors, ...childSelectors]);
        selectors = Array.from(uniqueSelectors);
      }

      // Ensure output directory exists
      if (!fs.existsSync(options.output)) {
        fs.mkdirSync(options.output, { recursive: true });
      }

      for (const selector of selectors) {
        console.log(`Processing selector: ${selector}`);

        try {
          // For complex class selectors, convert to data attribute
          const safeSelector = await page
            .evaluate((sel) => {
              // If it's already a data attribute selector, return as is
              if (sel.startsWith("[data-screenshot")) {
                return sel;
              }

              // Try to find the element with the original selector
              const element = document.querySelector(sel);
              if (!element) {
                throw new Error(`Element not found: ${sel}`);
              }

              // Add a unique data attribute
              const safeId = `screenshot-${Date.now()}-${Math.random()
                .toString(36)
                .slice(2)}`;
              element.setAttribute("data-screenshot", safeId);
              return `[data-screenshot="${safeId}"]`;
            }, selector)
            .catch((error) => {
              throw new Error(
                `Failed to process selector "${selector}": ${error.message}`
              );
            });

          if (options.animationTrigger) {
            console.log(`Triggering animations for: ${safeSelector}`);
            await triggerAnimation(page, safeSelector);
          }

          const waitTime = parseInt(options.wait);
          console.log(`Waiting ${waitTime}ms for animations to complete...`);
          await page.waitForTimeout(waitTime);

          // Use original selector for filename but safe selector for capturing
          const filename = generateFilename(selector, deviceType);
          const filepath = path.join(options.output, filename);

          await page.screenshot({
            path: filepath,
            fullPage: false,
          });

          console.log(`Screenshot saved: ${filepath}`);
        } catch (error) {
          console.error(`Error processing selector "${selector}":`, error);
          continue;
        }
      }

      await context.close();
    }
  } catch (error) {
    console.error("Error capturing screenshots:", error);
    if (error instanceof Error) {
      console.error(`Error message: ${error.message}`);
      console.error(`Error stack: ${error.stack}`);
    }
  } finally {
    await browser.close();
  }
}

async function triggerAnimation(page: Page, selector: string): Promise<void> {
  // First ensure the element is in view and get its dimensions
  await page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (element) {
      const rect = element.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const elementHeight = rect.height;

      // Calculate position to center element
      const targetScrollY = Math.max(
        0,
        window.pageYOffset + rect.top - (viewportHeight - elementHeight) / 2
      );

      // Scroll to position
      window.scrollTo({
        top: targetScrollY,
        behavior: "smooth",
      });
    }
  }, selector);

  // Wait for scroll animation
  await page.waitForTimeout(500);

  // Verify and adjust position if needed
  await page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (element) {
      const rect = element.getBoundingClientRect();
      const viewportHeight = window.innerHeight;

      // Check if element is properly centered
      const elementCenter = rect.top + rect.height / 2;
      const viewportCenter = viewportHeight / 2;
      const offset = Math.abs(elementCenter - viewportCenter);

      // If not centered well enough, adjust
      if (offset > 50) {
        // 50px tolerance
        const adjustment = elementCenter - viewportCenter;
        window.scrollBy({
          top: adjustment,
          behavior: "instant",
        });
      }
    }
  }, selector);

  // Final wait to ensure stability
  await page.waitForTimeout(200);
}

function getSelectors(options: CliOptions): string[] {
  if (options.config) {
    try {
      const configData = fs.readFileSync(options.config, "utf8");
      const config = JSON.parse(configData) as ConfigFile;
      return config.selectors || [];
    } catch (error) {
      console.error(`Error reading config file: ${error}`);
      return [];
    }
  }
  return options.selectors || [];
}

function generateFilename(
  selector: string,
  device: "desktop" | "mobile"
): string {
  // Remove CSS selector symbols and clean up the name
  const cleanSelector = selector
    .replace(/[#.]/g, "") // Remove # and . from selectors
    .replace(/[^a-z0-9]/gi, "_") // Replace other special chars with underscore
    .replace(/_+/g, "_") // Replace multiple underscores with single
    .replace(/^_|_$/g, "") // Remove leading/trailing underscores
    .toLowerCase();

  // Simple format without timestamp for overwriting
  return `${cleanSelector}__${device}.png`;
}

captureScreenshots().catch(console.error);
