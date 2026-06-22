import { test } from '@playwright/test';

test('debug read pixel', async ({ page }) => {
  await page.goto('http://localhost:5173/test/ch02-rendering/color-accuracy/');
  await page.waitForSelector('#info-engine', { timeout: 15000 });
  await page.waitForTimeout(1500);
  const result = await page.evaluate(async () => {
    const res = await fetch('/test/ch02-rendering/color-accuracy/main.ts');
    const source = await res.text();
    const match = source.match(/import\s*\{\s*Engine\s*\}\s*from\s*['"]([^'"]+)['"]/);
    const url = match ? match[1] : '/node_modules/.vite/deps/@babylonjs_core.js';
    const { Engine } = await import(url);
    const engine = Engine.Engines[0];
    const scene = engine.scenes[0];
    const texture = scene.textures.find((t: any) => t.name === 'texOriginal');
    const ctx = texture.getContext();
    const size = texture.getSize();
    const data = ctx.getImageData(18, 18, 1, 1).data;
    return {
      url,
      size,
      pixel: { r: data[0], g: data[1], b: data[2], a: data[3] },
      canvasSize: { width: ctx.canvas.width, height: ctx.canvas.height },
    };
  });
  console.log('debug result', JSON.stringify(result, null, 2));
});
