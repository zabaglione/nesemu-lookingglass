import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const source = fs.readFileSync(path.resolve("src/scene/lookingglassOutput.ts"), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const output = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

test("screen selection handles negative coordinates and ambiguity", () => {
  const screens = [
    { label: "Looking Glass", left: -1920, top: 0, width: 1920, height: 1080 },
    { label: "Looking Glass duplicate", left: 0, top: 0, width: 1920, height: 1080 },
  ];
  assert.equal(output.chooseLookingGlassScreen(screens, 3840, 2160, 2), null);
  assert.equal(output.chooseLookingGlassScreen([screens[0]], 3840, 2160, 2), screens[0]);
});

test("canvas CSS size preserves calibrated physical pixels across DPI", () => {
  for (const dpr of [1, 1.25, 1.5]) {
    const size = output.canvasCssSize(3840, 2160, dpr);
    assert.equal(Math.round(size.width * dpr), 3840);
    assert.equal(Math.round(size.height * dpr), 2160);
  }
});

test("maximized window is not pixel exact until fullscreen viewport matches calibration", () => {
  assert.equal(output.pixelExactStatus(1920, 1080, 1, 3840, 2160, false).pixelExact, false);
  assert.equal(output.pixelExactStatus(1920, 1080, 2, 3840, 2160, true).pixelExact, true);
  assert.equal(output.pixelExactStatus(1600, 900, 2, 3840, 2160, true).pixelExact, false);
});
