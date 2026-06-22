import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const BASE_URL = 'http://localhost:5173/test/ch03-actor-system/player-diplomacy/';
const SNAPSHOT_DIR = 'test-results/manual/ch03-actor-system/player-diplomacy';
const EVIDENCE_DIR = `${SNAPSHOT_DIR}/evidence`;

function evidenceFile(name: string): string {
  const dir = path.resolve(EVIDENCE_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(EVIDENCE_DIR, name);
}

interface PlayerColor {
  name: string;
  argb: number;
  r: number;
  g: number;
  b: number;
}

interface RelationshipCase {
  viewer: string;
  target: string;
  relationship: 'self' | 'ally' | 'neutral' | 'enemy';
  argb: number;
  r: number;
  g: number;
  b: number;
}

const ORIGINAL_COLORS: PlayerColor[] = [
  { name: 'Player A', argb: 0xff3399f2, r: 51, g: 153, b: 242 },
  { name: 'Player B', argb: 0xfff25433, r: 242, g: 84, b: 51 },
  { name: 'Player C', argb: 0xff33cc66, r: 51, g: 204, b: 102 },
  { name: 'Player D', argb: 0xffff9933, r: 255, g: 153, b: 51 },
  { name: 'Neutral', argb: 0xffb0b0b0, r: 176, g: 176, b: 176 },
];

const VIEWER_A_RELATIONSHIPS: RelationshipCase[] = [
  { viewer: 'Player A', target: 'Player A', relationship: 'self', argb: 0xff00ff00, r: 0, g: 255, b: 0 },
  { viewer: 'Player A', target: 'Player B', relationship: 'enemy', argb: 0xffff0000, r: 255, g: 0, b: 0 },
  { viewer: 'Player A', target: 'Player C', relationship: 'ally', argb: 0xffffff00, r: 255, g: 255, b: 0 },
  { viewer: 'Player A', target: 'Player D', relationship: 'neutral', argb: 0xffffffff, r: 255, g: 255, b: 255 },
  { viewer: 'Player A', target: 'Neutral', relationship: 'neutral', argb: 0xffffffff, r: 255, g: 255, b: 255 },
];

function argbToRgb(argb: number): { r: number; g: number; b: number } {
  return {
    r: (argb >> 16) & 0xff,
    g: (argb >> 8) & 0xff,
    b: argb & 0xff,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function parseCssColor(cssColor: string): { r: number; g: number; b: number; a: number } | null {
  const rgbMatch = cssColor.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10),
      g: parseInt(rgbMatch[2], 10),
      b: parseInt(rgbMatch[3], 10),
      a: rgbMatch[4] === undefined ? 1 : parseFloat(rgbMatch[4]),
    };
  }
  const hexMatch = cssColor.match(/#([0-9a-fA-F]{3,8})/);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    } else if (hex.length === 4) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    return {
      r: parseInt(hex.substring(0, 2), 16),
      g: parseInt(hex.substring(2, 4), 16),
      b: parseInt(hex.substring(4, 6), 16),
      a: hex.length >= 8 ? parseInt(hex.substring(6, 8), 16) / 255 : 1,
    };
  }
  return null;
}

function deltaE(rgb1: { r: number; g: number; b: number }, rgb2: { r: number; g: number; b: number }): number {
  const rDiff = rgb1.r - rgb2.r;
  const gDiff = rgb1.g - rgb2.g;
  const bDiff = rgb1.b - rgb2.b;
  return Math.sqrt(rDiff * rDiff + gDiff * gDiff + bDiff * bDiff);
}

function parseArgbText(text: string): number | null {
  const match = text.match(/0x([0-9a-fA-F]{8})/);
  if (!match) return null;
  return parseInt(match[1], 16);
}

async function waitForSceneReady(page: any): Promise<void> {
  await page.waitForSelector('#canvas-panel canvas', { timeout: 15000 });
  await page.waitForSelector('#info-engine', { timeout: 15000 });
  await page.waitForFunction(() => {
    const engineText = document.getElementById('info-engine')?.textContent || '';
    return engineText.includes('Babylon.js') && engineText.includes('WebGL');
  }, { timeout: 10000 });
  await page.waitForFunction(() => {
    const fpsText = document.getElementById('info-fps')?.textContent || '0';
    return parseInt(fpsText.trim(), 10) > 0;
  }, { timeout: 10000 });
}

async function getViewerName(page: any): Promise<string> {
  return (await page.locator('#viewer-label').textContent() || '').trim();
}

async function getColorRows(page: any): Promise<any[]> {
  return page.locator('#color-rows .color-row').all();
}

async function getRowData(row: any): Promise<{
  name: string;
  classes: string[];
  originalArgb: number | null;
  displayArgb: number | null;
  desc: string;
  bgColor: string;
}> {
  const name = (await row.locator('.color-meta .name').textContent() || '').trim();
  const classAttr = (await row.getAttribute('class')) || '';
  const classes = classAttr.split(/\s+/).filter((c: string) => c.length > 0);

  const originalText = (await row.locator('.color-meta .argb').nth(0).textContent() || '').trim();
  const displayText = (await row.locator('.color-meta .argb').nth(1).textContent() || '').trim();
  const desc = (await row.locator('.color-meta .desc').textContent() || '').trim();
  const bgColor = (await row.locator('.swatch').evaluate((el: HTMLElement) => getComputedStyle(el).backgroundColor)) || '';

  const originalMatch = originalText.match(/0x([0-9a-fA-F]{8})/);
  const displayMatch = displayText.match(/0x([0-9a-fA-F]{8})/);

  return {
    name,
    classes,
    originalArgb: originalMatch ? parseInt(originalMatch[1], 16) : null,
    displayArgb: displayMatch ? parseInt(displayMatch[1], 16) : null,
    desc,
    bgColor,
  };
}

function relationFromClass(classAttr: string): string {
  if (classAttr.includes('rel-ally')) return 'ally';
  if (classAttr.includes('rel-neutral')) return 'neutral';
  if (classAttr.includes('rel-enemy')) return 'enemy';
  if (classAttr.includes('rel-self')) return 'self';
  return 'unknown';
}

async function getRelationshipGridState(page: any): Promise<string[][]> {
  const cells = await page.locator('#rel-grid > div.cell').all();
  // First row is the header (6 cells: empty + 5 player initials).
  // Each subsequent row is 6 cells: row-hdr + 5 relation cells.
  const state: string[][] = [];
  for (let i = 6; i < cells.length; i += 6) {
    const rowCells = cells.slice(i, i + 6);
    const rowValues: string[] = [];
    for (let c = 1; c < rowCells.length; c++) {
      const classAttr = (await rowCells[c].getAttribute('class')) || '';
      rowValues.push(relationFromClass(classAttr));
    }
    state.push(rowValues);
  }
  return state;
}

async function findViewerRowIndex(page: any): Promise<number> {
  const rows = await page.locator('#rel-grid > div.cell').all();
  for (let i = 6; i < rows.length; i += 6) {
    const rowCells = rows.slice(i, i + 6);
    for (let c = 1; c < rowCells.length; c++) {
      const text = (await rowCells[c].textContent() || '').trim();
      if (text.includes('▶')) return (i - 6) / 6;
    }
  }
  return -1;
}

async function resetToInitialState(page: any): Promise<void> {
  await page.click('#btn-reset');
  await page.waitForTimeout(300);
}

async function setStanceColorsEnabled(page: any, enabled: boolean): Promise<void> {
  const checkbox = page.locator('#chk-stance-colors');
  const isChecked = await checkbox.isChecked();
  if (isChecked !== enabled) {
    await checkbox.click();
    await page.waitForTimeout(300);
  }
}

async function verifyColorApprox(
  actualCss: string,
  expected: { r: number; g: number; b: number },
  label: string
): Promise<void> {
  const parsed = parseCssColor(actualCss);
  expect(parsed, `${label}: should parse CSS color "${actualCss}"`).not.toBeNull();
  if (!parsed) return;
  const de = deltaE(parsed, expected);
  expect(de, `${label}: deltaE should be <= 10, got ${de}`).toBeLessThanOrEqual(10);
}

test.use({ snapshotDir: SNAPSHOT_DIR });

test.describe('Ch03 Actor System - Player Diplomacy', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await waitForSceneReady(page);
    await page.waitForTimeout(3000);
  });

  test('test-1: original ARGB colors render correctly when stance colors disabled', async ({ page }) => {
    await setStanceColorsEnabled(page, false);
    await page.waitForTimeout(500);

    const rows = await getColorRows(page);
    expect(rows.length, 'should have 5 color rows').toBe(5);

    for (let i = 0; i < ORIGINAL_COLORS.length; i++) {
      const expected = ORIGINAL_COLORS[i];
      const row = rows[i];
      const data = await getRowData(row);

      expect(data.name, `row ${i} name`).toContain(expected.name.replace('Player ', ''));
      expect(data.originalArgb, `row ${i} original ARGB`).toBe(expected.argb);
      expect(data.displayArgb, `row ${i} display ARGB should match original`).toBe(expected.argb);

      await verifyColorApprox(data.bgColor, { r: expected.r, g: expected.g, b: expected.b }, `${expected.name} swatch`);
    }

    await page.screenshot({ path: evidenceFile('screenshot-1-original-colors.png') });
  });

  test('test-2: relationship color mapping is correct for viewer Player A', async ({ page }) => {
    await setStanceColorsEnabled(page, true);
    await resetToInitialState(page);
    await page.waitForTimeout(500);

    expect(await getViewerName(page)).toBe('Player A');

    const rows = await getColorRows(page);
    expect(rows.length).toBe(5);

    const rowData = await Promise.all(rows.map((r: any) => getRowData(r)));

    for (const expected of VIEWER_A_RELATIONSHIPS) {
      const searchName = expected.target.replace('Player ', '');
      const data = rowData.find((d) => d.name.includes(searchName));
      expect(data, `row for ${expected.target}`).toBeDefined();
      if (!data) continue;

      expect(data.classes, `${expected.target} row classes`).toContain(expected.relationship);
      expect(data.displayArgb, `${expected.target} display ARGB`).toBe(expected.argb);

      await verifyColorApprox(
        data.bgColor,
        { r: expected.r, g: expected.g, b: expected.b },
        `${expected.target} relationship swatch`
      );
    }

    const gridState = await getRelationshipGridState(page);
    expect(gridState.length).toBe(5);
    expect(gridState[0][0], 'self cell should be self').toBe('self');
    expect(gridState[0][1], 'B from A should be enemy').toBe('enemy');
    expect(gridState[0][2], 'C from A should be ally').toBe('ally');
    expect(gridState[0][3], 'D from A should be neutral').toBe('neutral');
    expect(gridState[0][4], 'Neutral from A should be neutral').toBe('neutral');

    await page.screenshot({ path: evidenceFile('screenshot-2-relationship-colors-viewer-a.png') });
  });

  test('test-3: viewer switching updates relationship colors and grid markers', async ({ page }) => {
    await setStanceColorsEnabled(page, true);
    await resetToInitialState(page);
    await page.waitForTimeout(500);

    const viewerSequence = ['Player A', 'Player B', 'Player C', 'Player D', 'Neutral'];
    const viewerIndexMap: Record<string, number> = { 'Player A': 0, 'Player B': 1, 'Player C': 2, 'Player D': 3, 'Neutral': 4 };

    for (const viewer of viewerSequence) {
      if (viewer !== 'Player A') {
        await page.click('#btn-cycle-viewer');
        await page.waitForTimeout(500);
      }

      const currentViewer = await getViewerName(page);
      expect(currentViewer, `viewer should be ${viewer}`).toBe(viewer);

      const viewerRowIndex = await findViewerRowIndex(page);
      expect(viewerRowIndex, `viewer row marker should be present for ${viewer}`).toBe(viewerIndexMap[viewer]);

      const rows = await getColorRows(page);
      expect(rows.length).toBe(5);
      const rowData = await Promise.all(rows.map((r: any) => getRowData(r)));

      for (let i = 0; i < rowData.length; i++) {
        const data = rowData[i];
        const hasRelationshipClass = ['self', 'ally', 'neutral', 'enemy'].some((cls) => data.classes.includes(cls));
        expect(hasRelationshipClass, `row ${i} should have a relationship class`).toBe(true);

        if (i === viewerIndexMap[viewer]) {
          expect(data.classes, `${viewer} self row`).toContain('self');
          expect(data.displayArgb, `${viewer} self ARGB`).toBe(0xff00ff00);
          await verifyColorApprox(data.bgColor, { r: 0, g: 255, b: 0 }, `${viewer} self swatch`);
        }
      }

      if (viewer === 'Player A') {
        const playerBData = rowData[1];
        expect(playerBData.classes).toContain('enemy');
        expect(playerBData.displayArgb).toBe(0xffff0000);
        const playerCData = rowData[2];
        expect(playerCData.classes).toContain('ally');
        expect(playerCData.displayArgb).toBe(0xffffff00);
      }

      if (viewer === 'Player B') {
        const playerAData = rowData[0];
        expect(playerAData.classes).toContain('enemy');
        expect(playerAData.displayArgb).toBe(0xffff0000);

        const playerDData = rowData[3];
        expect(playerDData.classes).toContain('ally');
        expect(playerDData.displayArgb).toBe(0xffffff00);
      }

      if (viewer === 'Neutral') {
        for (let i = 0; i < 4; i++) {
          expect(rowData[i].classes, `Neutral viewer: Player ${String.fromCharCode(65 + i)} should be neutral`).toContain('neutral');
          expect(rowData[i].displayArgb).toBe(0xffffffff);
        }
      }

      await page.screenshot({ path: evidenceFile(`screenshot-3-viewer-${viewer.toLowerCase().replace(' ', '-')}.png`) });
    }
  });

  test('test-4: disabling stance colors restores original colors', async ({ page }) => {
    await setStanceColorsEnabled(page, true);
    await resetToInitialState(page);
    await page.waitForTimeout(500);

    await setStanceColorsEnabled(page, false);
    await page.waitForTimeout(500);

    const rows = await getColorRows(page);
    expect(rows.length).toBe(5);

    for (let i = 0; i < ORIGINAL_COLORS.length; i++) {
      const expected = ORIGINAL_COLORS[i];
      const data = await getRowData(rows[i]);
      expect(data.displayArgb, `${expected.name} display ARGB restored`).toBe(expected.argb);
      expect(data.desc, `${expected.name} desc`).toContain('关系色禁用');
      await verifyColorApprox(data.bgColor, { r: expected.r, g: expected.g, b: expected.b }, `${expected.name} restored swatch`);
    }

    const seenColors = new Set<number>();
    for (const expected of ORIGINAL_COLORS) {
      seenColors.add(expected.argb);
    }
    expect(seenColors.size, 'all original colors should be distinct').toBe(ORIGINAL_COLORS.length);

    await page.screenshot({ path: evidenceFile('screenshot-4-stance-colors-disabled.png') });
  });

  test('test-5: random relations update matrix and scene correctly', async ({ page }) => {
    await setStanceColorsEnabled(page, true);
    await resetToInitialState(page);
    await page.waitForTimeout(500);

    const initialGrid = await getRelationshipGridState(page);
    expect(initialGrid.length).toBeGreaterThan(0);

    const observedRelations = new Set<string>();
    let changedAtLeastOnce = false;

    for (let i = 0; i < 6; i++) {
      await page.click('#btn-random-relations');
      await page.waitForTimeout(400);

      const grid = await getRelationshipGridState(page);
      expect(grid.length).toBe(initialGrid.length);

      let hasChangeFromInitial = false;
      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[r].length; c++) {
          if (grid[r][c] !== initialGrid[r][c]) hasChangeFromInitial = true;
          if (r === c) {
            expect(grid[r][c], `diagonal [${r},${c}] should remain self`).toBe('self');
          } else {
            observedRelations.add(grid[r][c]);
          }
        }
      }
      if (hasChangeFromInitial) changedAtLeastOnce = true;

      const rows = await getColorRows(page);
      const viewerRowIndex = await findViewerRowIndex(page);
      for (let r = 0; r < rows.length; r++) {
        const data = await getRowData(rows[r]);
        const expectedRelation = grid[viewerRowIndex][r];
        expect(data.classes, `row ${r} class should match grid relation ${expectedRelation}`).toContain(expectedRelation);
      }

      await page.screenshot({ path: evidenceFile(`screenshot-5-random-relations-${i + 1}.png`) });
    }

    expect(changedAtLeastOnce, 'random relations should change the matrix at least once').toBe(true);
    expect(observedRelations.has('ally'), 'ally relation should appear').toBe(true);
    expect(observedRelations.has('neutral'), 'neutral relation should appear').toBe(true);
    expect(observedRelations.has('enemy'), 'enemy relation should appear').toBe(true);
  });

  test('test-6: color panel information completeness and data binding consistency', async ({ page }) => {
    await setStanceColorsEnabled(page, true);
    await resetToInitialState(page);
    await page.waitForTimeout(500);

    const rows = await getColorRows(page);
    expect(rows.length).toBe(5);

    for (const row of rows) {
      const nameEl = row.locator('.color-meta .name');
      const originalArgbEl = row.locator('.color-meta .argb').nth(0);
      const displayArgbEl = row.locator('.color-meta .argb').nth(1);
      const descEl = row.locator('.color-meta .desc');
      const swatchEl = row.locator('.swatch');

      await expect(nameEl).toBeVisible();
      await expect(originalArgbEl).toBeVisible();
      await expect(displayArgbEl).toBeVisible();
      await expect(descEl).toBeVisible();
      await expect(swatchEl).toBeVisible();

      const name = (await nameEl.textContent() || '').trim();
      expect(name.length).toBeGreaterThan(0);

      const originalText = (await originalArgbEl.textContent() || '').trim();
      const displayText = (await displayArgbEl.textContent() || '').trim();
      expect(originalText).toMatch(/原始:\s*0x[0-9a-fA-F]{8}/);
      expect(displayText).toMatch(/显示:\s*0x[0-9a-fA-F]{8}/);

      const desc = (await descEl.textContent() || '').trim();
      expect(desc.length).toBeGreaterThan(0);

      const bgColor = (await swatchEl.evaluate((el: HTMLElement) => getComputedStyle(el).backgroundColor)) || '';
      const displayArgb = parseArgbText(displayText);
      if (displayArgb !== null) {
        const rgb = argbToRgb(displayArgb);
        await verifyColorApprox(bgColor, rgb, `${name} swatch matches display ARGB`);
      }
    }

    const viewerIndex = await findViewerRowIndex(page);
    expect(viewerIndex).toBeGreaterThanOrEqual(0);

    const gridCells = await page.locator('#rel-grid > div.cell').all();
    expect(gridCells.length).toBe(36); // 6 header cells + 5 rows of 6 cells
    for (let row = 0; row < 5; row++) {
      const rowStart = 6 + row * 6;
      const rowCells = gridCells.slice(rowStart, rowStart + 6);
      let rowHasMarker = false;
      for (let c = 1; c < rowCells.length; c++) {
        const text = (await rowCells[c].textContent() || '').trim();
        if (text.includes('▶')) rowHasMarker = true;
      }
      if (row === viewerIndex) {
        expect(rowHasMarker, `viewer row ${row} should contain ▶ marker`).toBe(true);
      } else {
        expect(rowHasMarker, `non-viewer row ${row} should not contain ▶ marker`).toBe(false);
      }
    }

    const infoIds = ['info-ua', 'info-viewport', 'info-engine', 'info-fps', 'info-time'];
    for (const id of infoIds) {
      const el = page.locator(`#${id}`);
      await expect(el).toBeVisible();
      const text = (await el.textContent() || '').trim();
      expect(text.length).toBeGreaterThan(0);
    }

    await page.screenshot({ path: evidenceFile('screenshot-6-panel-completeness.png') });
  });
});
