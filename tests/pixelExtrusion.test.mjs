import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const source = fs.readFileSync(path.resolve("src/scene/pixelExtrusion.ts"), "utf8");
const threeUrl = pathToFileURL(path.resolve("node_modules/three/build/three.module.js")).href;
const js = ts.transpileModule(source.replace('from "three"', `from "${threeUrl}"`), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

function image(width, height, pixels) {
  const data = new Uint8Array(width * height * 4);
  for (const [x, y] of pixels) data[(y * width + x) * 4 + 3] = 255;
  return data;
}

test("single pixel creates four non-degenerate boundary faces", () => {
  const b = new mod.PixelExtrusionBuffer({ width: 3, height: 3, planeWidth: 1, planeHeight: 1 });
  b.update(image(3, 3, [[1, 1]]));
  assert.equal(b.faces, 4);
  const pos = b.geometry.getAttribute("position").array;
  for (let q = 0; q < b.faces; q++) {
    const a = q * 12;
    const ax = pos[a], ay = pos[a + 1], bx = pos[a + 3], by = pos[a + 4];
    assert.ok(Math.abs(ax - bx) + Math.abs(ay - by) > 0);
  }
});

test("an 8 pixel ring creates outer and inner hole boundaries", () => {
  const b = new mod.PixelExtrusionBuffer({ width: 3, height: 3, planeWidth: 1, planeHeight: 1 });
  b.update(image(3, 3, [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]]));
  assert.equal(b.faces, 16);
  const uv = b.geometry.getAttribute("uv").array;
  for (let i = 0; i < uv.length; i += 8) assert.equal(uv[i], uv[i + 2]);
  const geometry = b.geometry;
  b.update(image(3, 3, []));
  assert.equal(b.faces, 0);
  assert.equal(b.geometry, geometry);
});

test("capacity growth preserves the reusable geometry object", () => {
  const b = new mod.PixelExtrusionBuffer({ width: 20, height: 20, planeWidth: 1, planeHeight: 1 });
  const geometry = b.geometry;
  const checker = [];
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) if ((x + y) % 2 === 0) checker.push([x, y]);
  b.update(image(20, 20, checker));
  assert.ok(b.faces > 256);
  assert.equal(b.geometry, geometry);
});

test("vertical orientation follows the lower-left RGBA row order", () => {
  const b = new mod.PixelExtrusionBuffer({ width: 2, height: 2, planeWidth: 1, planeHeight: 1 });
  b.update(image(2, 2, [[0, 1]]));
  const pos = b.geometry.getAttribute("position").array;
  const ys = [];
  for (let i = 1; i < 12; i += 3) ys.push(pos[i]);
  assert.ok(Math.min(...ys) >= -0.001);
});

test("zero alpha produces no boundary faces", () => {
  const b = new mod.PixelExtrusionBuffer({ width: 2, height: 2, planeWidth: 1, planeHeight: 1 });
  b.update(image(2, 2, []));
  assert.equal(b.faces, 0);
});
