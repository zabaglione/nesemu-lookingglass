import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const source = fs.readFileSync(path.resolve("src/scene/stereoMath.ts"), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const math = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

test("target diameter fits both landscape and portrait calibration", () => {
  const landscape = math.fitTargetDiam(1, 0.8166667, 3840, 2160);
  const portrait = math.fitTargetDiam(1, 0.8166667, 2160, 3840);
  assert.ok(landscape >= 0.8166667 * 1.15);
  assert.ok(portrait >= 1 * 1.15);
  assert.notEqual(landscape, portrait);
});
