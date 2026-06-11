# Terrain Mesh — Basic Visual Test

## Expected Results

1. **Flat terrain (key `1`)**: A continuous 8x8 rectangular grid with no visible cracks between cells. The grid should appear as a flat plane at Y=0.

2. **Ramp terrain (key `2`)**: A diagonal slope rising from SW to NE. The terrain should show visible height variation with smooth transitions between cells. No cracks should be visible at cell boundaries.

3. **Isometric terrain (key `3`)**: A diamond-shaped 8x8 grid. The cells should form a staggered pattern characteristic of isometric projection.

4. **Wireframe mode (key `W`)**: Toggles between solid shading and wireframe. In wireframe mode, the triangle mesh structure should be clearly visible, with shared edges between adjacent cells (no duplicate lines at boundaries).

## Verification Steps

1. Load the page and verify a flat green grid appears.
2. Press `2` — verify the terrain shows a diagonal slope.
3. Press `3` — verify the terrain switches to diamond-shaped isometric layout.
4. Press `W` — verify wireframe mode shows clean triangle edges without duplicate lines.
5. Rotate camera (left drag) to inspect from below — verify no holes or cracks.
6. Zoom in (scroll) to inspect cell boundaries — verify vertices are perfectly shared.

## Quantifiable Criteria

- Flat 8x8 grid: exactly 81 vertices (9x9), 128 triangles (8x8x2)
- Isometric 8x8 grid: vertex count > 0, triangle count > 0
- Ramp terrain: max vertex Y > 0 (visible height variation)
- No cracks: wireframe shows single lines at cell boundaries (no double lines)
