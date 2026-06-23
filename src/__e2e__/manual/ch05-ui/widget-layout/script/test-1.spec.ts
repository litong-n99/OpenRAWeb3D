import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

// -----------------------------------------------------------------------------
// Acceptance test: Widget Layout — Nested bounds, padding, z-order, alignment
// URL: http://localhost:5173/test/ch05-ui/widget-layout/
//
// This is a pure-DOM page (no WebGL). Widgets are absolute-positioned <div>
// elements inside #sandbox. The page exposes window.__testHarness for querying
// widget bounds, padding, z-order and count.
// -----------------------------------------------------------------------------

interface WidgetBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface WidgetTestHarness {
  createWidgetTree(config: 'tree3' | 'tree5'): void;
  getWidgetBounds(id: string): WidgetBounds | null;
  getWidgetZOrder(id: string): number | null;
  getComputedPadding(id: string): number | null;
  getWidgetCount(): number;
  reset(): void;
}

const PAGE_URL = '/test/ch05-ui/widget-layout/';
const EVIDENCE_DIR = path.resolve(
  process.cwd(),
  'test-results/manual/ch05-ui/widget-layout/evidence'
);

function evidencePath(name: string): string {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
  return path.join(EVIDENCE_DIR, name);
}

async function waitForHarnessReady(page: Page, timeout = 10000): Promise<void> {
  await page.waitForSelector('#sandbox', { timeout });
  await page.waitForFunction(
    () => {
      const h = (window as any).__testHarness as Partial<WidgetTestHarness> | undefined;
      return (
        !!h &&
        typeof h.createWidgetTree === 'function' &&
        typeof h.getWidgetBounds === 'function' &&
        typeof h.getWidgetZOrder === 'function' &&
        typeof h.getComputedPadding === 'function' &&
        typeof h.getWidgetCount === 'function'
      );
    },
    { timeout }
  );
}

async function buildTree(page: Page, config: 'tree3' | 'tree5'): Promise<void> {
  await page.evaluate((c) => (window as any).__testHarness.createWidgetTree(c), config);
  // Give the browser a tick to render the absolutely-positioned widgets.
  await page.waitForTimeout(150);
}

async function getBounds(page: Page, id: string): Promise<WidgetBounds | null> {
  return page.evaluate((widgetId) => (window as any).__testHarness.getWidgetBounds(widgetId), id);
}

async function getZOrder(page: Page, id: string): Promise<number | null> {
  return page.evaluate((widgetId) => (window as any).__testHarness.getWidgetZOrder(widgetId), id);
}

async function getPadding(page: Page, id: string): Promise<number | null> {
  return page.evaluate(
    (widgetId) => (window as any).__testHarness.getComputedPadding(widgetId),
    id
  );
}

async function getWidgetCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__testHarness.getWidgetCount());
}

test.describe('Widget Layout — Nested Bounds & Z-Order', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL);
    await waitForHarnessReady(page);
  });

  // ---------------------------------------------------------------------------
  // L1. Child Bounds Clipped to Parent
  // ---------------------------------------------------------------------------
  test('L1: child bounds are contained within parent bounds after Tree3', async ({ page }) => {
    await buildTree(page, 'tree3');

    const root = await getBounds(page, 'root');
    const childA = await getBounds(page, 'childA');
    const childB = await getBounds(page, 'childB');

    expect(root).not.toBeNull();
    expect(childA).not.toBeNull();
    expect(childB).not.toBeNull();

    const r = root!;
    const a = childA!;
    const b = childB!;

    // L1.1: children must not overflow their parent.
    expect(a.x + a.w).toBeLessThanOrEqual(r.x + r.w);
    expect(a.y + a.h).toBeLessThanOrEqual(r.y + r.h);
    expect(b.x + b.w).toBeLessThanOrEqual(r.x + r.w);
    expect(b.y + b.h).toBeLessThanOrEqual(r.y + r.h);

    // L1.2: child offset from parent edge should respect parent padding.
    const padRoot = await getPadding(page, 'root');
    expect(padRoot).toBe(15);

    // Offsets are computed in sandbox space: child position minus parent origin.
    expect(a.x - r.x).toBeGreaterThanOrEqual(padRoot!);
    expect(a.y - r.y).toBeGreaterThanOrEqual(padRoot!);
    expect(b.x - r.x).toBeGreaterThanOrEqual(padRoot!);
    expect(b.y - r.y).toBeGreaterThanOrEqual(padRoot!);

    await page.screenshot({ path: evidencePath('01-tree3-layout.png') });
  });

  // ---------------------------------------------------------------------------
  // L2. Padding Reduces Content Area
  // ---------------------------------------------------------------------------
  test('L2: padding values match configuration after Tree3', async ({ page }) => {
    await buildTree(page, 'tree3');

    expect(await getPadding(page, 'root')).toBe(15);
    expect(await getPadding(page, 'childA')).toBe(10);
    expect(await getPadding(page, 'childB')).toBe(10);
  });

  // ---------------------------------------------------------------------------
  // L3. Z-Order Render Correct
  // ---------------------------------------------------------------------------
  test('L3: z-order is correct after Tree3 and l1b can be brought to top after Tree5', async ({
    page,
  }) => {
    // L3.1: Tree3 — childB renders above childA.
    await buildTree(page, 'tree3');
    const zChildA = await getZOrder(page, 'childA');
    const zChildB = await getZOrder(page, 'childB');
    expect(zChildA).toBe(10);
    expect(zChildB).toBe(11);
    expect(zChildB!).toBeGreaterThan(zChildA!);

    // L3.2: Tree5 — click the z-order button and verify l1b is brought to top.
    await buildTree(page, 'tree5');
    await page.locator('#btnZOrder').click();
    await page.waitForTimeout(150);

    expect(await getZOrder(page, 'l1b')).toBe(999);

    await page.screenshot({ path: evidencePath('02-tree5-zorder-top.png') });
  });

  // ---------------------------------------------------------------------------
  // L4. Center Alignment
  // ---------------------------------------------------------------------------
  test('L4: center-aligned childB is horizontally centered in root', async ({ page }) => {
    await buildTree(page, 'tree3');

    const root = (await getBounds(page, 'root'))!;
    const before = (await getBounds(page, 'childB'))!;

    // The Align button should reposition childB to the horizontal center of root.
    await page.locator('#btnAlign').click();
    await page.waitForTimeout(150);

    const after = (await getBounds(page, 'childB'))!;

    // The button updates its own label to indicate the action completed.
    await expect(page.locator('#btnAlign')).toHaveText('Align: Done');

    // Center of childB relative to root's content area should match root's center.
    const childCenterRelative = after.x + after.w / 2 - root.x;
    const rootCenter = root.w / 2;
    expect(Math.abs(childCenterRelative - rootCenter)).toBeLessThan(2);

    // Sanity: width and height are unchanged by alignment.
    expect(after.w).toBe(before.w);
    expect(after.h).toBe(before.h);

    await page.screenshot({ path: evidencePath('03-align-center.png') });
  });

  // ---------------------------------------------------------------------------
  // L5. Depth 5 No Clipping Artifacts
  // ---------------------------------------------------------------------------
  test('L5: depth-5 tree renders 8 widgets and l4 is correctly nested', async ({ page }) => {
    await buildTree(page, 'tree5');

    expect(await getWidgetCount(page)).toBe(8);

    // DOM count of widget divs inside #sandbox.
    await expect(page.locator('#sandbox .widget')).toHaveCount(8);

    // Specific Tree5 widgets exist.
    for (const id of ['root', 'l1a', 'l1b', 'l2a', 'l2b', 'l3a', 'l3b', 'l4']) {
      await expect(page.locator(`#w-${id}`)).toHaveCount(1);
    }

    // L5.2: deepest widget l4 has valid positive bounds.
    const l4 = await getBounds(page, 'l4');
    expect(l4).not.toBeNull();
    expect(l4!.w).toBeGreaterThan(0);
    expect(l4!.h).toBeGreaterThan(0);

    // Parent chain: l4 → l3a → l2a → l1a → root.
    const parentChain = await page.evaluate(() => {
      const parentOf = (id: string) =>
        document.getElementById(`w-${id}`)?.parentElement?.id ?? null;
      return {
        l4: parentOf('l4'),
        l3a: parentOf('l3a'),
        l2a: parentOf('l2a'),
        l1a: parentOf('l1a'),
      };
    });
    expect(parentChain.l4).toBe('w-l3a');
    expect(parentChain.l3a).toBe('w-l2a');
    expect(parentChain.l2a).toBe('w-l1a');
    expect(parentChain.l1a).toBe('w-root');

    await page.screenshot({ path: evidencePath('04-tree5-depth5.png') });
  });

  // ---------------------------------------------------------------------------
  // Additional verification: reset clears all widgets
  // ---------------------------------------------------------------------------
  test('Reset clears all widgets', async ({ page }) => {
    await buildTree(page, 'tree5');
    await expect(page.locator('#sandbox .widget')).toHaveCount(8);

    await page.locator('#btnReset').click();
    await page.waitForTimeout(150);

    expect(await getWidgetCount(page)).toBe(0);
    await expect(page.locator('#sandbox .widget')).toHaveCount(0);

    await page.screenshot({ path: evidencePath('05-reset-cleared.png') });
  });
});
