import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const threeUrl = pathToFileURL(path.resolve("node_modules/three/build/three.module.js")).href;
const compile = (file, replacements = []) => {
  let source = fs.readFileSync(file, "utf8").replaceAll('from "three"', `from "${threeUrl}"`);
  for (const [from, to] of replacements) source = source.replace(from, to);
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
};
const pixelUrl = `data:text/javascript;base64,${Buffer.from(compile(path.resolve("src/scene/pixelExtrusion.ts"))).toString("base64")}`;
const coreUrl = `data:text/javascript;base64,${Buffer.from("export const VISIBLE_W=240; export const VISIBLE_H=224;").toString("base64")}`;
const stageJs = compile(path.resolve("src/scene/stage.ts"), [[/from "\.\.\/emulator\/core"/, `from "${coreUrl}"`], [/from "\.\/pixelExtrusion"/, `from "${pixelUrl}"`]]);
const { Stage } = await import(`data:text/javascript;base64,${Buffer.from(stageJs).toString("base64")}`);

const frame = (visible = false, priority = "front", depth = 0.5) => {
  const rgba = new Uint8Array(240 * 224 * 4);
  if (visible) rgba[3] = 255;
  return { rgba, visible, priority, depth };
};
const frames = { bg: new Uint8Array(240 * 224 * 4), sprBehind: new Uint8Array(240 * 224 * 4), sprFront: new Uint8Array(240 * 224 * 4), spriteGroups: [frame(true, "behind", 0), frame(true, "front", 1), ...Array.from({ length: 6 }, () => frame())], backdrop: [0, 0, 0] };
frames.bg[3] = 255;
frames.spriteGroups[0].rgba[3] = 255;
frames.spriteGroups[1].rgba[3] = 255;

test("Stage pixel mode reuses geometry and restores requested thickness", () => {
  const stage = new Stage(frames);
  stage.setLayerGap(0.004);
  stage.setPixelBackgroundThickness(0.3);
  stage.commitFrame(frames);
  stage.setLayerGap(0.3);
  stage.commitFrame(frames);
  const background = stage.bg;
  assert.ok(background.thickness > 0);
  assert.equal(background.back.visible, true);
  const version = background.side.geometry.getAttribute("position").version;
  stage.commitFrame(frames);
  assert.equal(background.side.geometry.getAttribute("position").version, version);
  stage.commitFrame(frames);
  assert.ok(background.group.visible);
});

test("pixel thickness stays between every visible layer at all gaps and depths", () => {
  for (const gap of [0.004, 0.04, 0.3]) {
    for (const depth of [0, 1]) {
      const local = structuredClone(frames);
      local.spriteGroups = [frame(true, "behind", depth), frame(true, "front", depth), ...Array.from({ length: 6 }, () => frame())];
      local.bg[3] = 255;
      const stage = new Stage(local);
      stage.setSpriteDepthSpread(1.5);
      stage.setLayerGap(gap);
      stage.setPixelBackgroundThickness(0.3);
      stage.setPixelSpriteThickness(0.3);
      stage.commitFrame(local);
      const bg = stage.bg;
      const behind = stage.sprites[0];
      const front = stage.sprites[1];
      assert.ok(bg.group.position.z - bg.thickness > behind.group.position.z);
      assert.ok(front.group.position.z - front.thickness > bg.group.position.z);
      assert.ok(behind.group.position.z - behind.thickness > stage.backdrop.position.z);
    }
  }
});

test("zero thickness hides all back and side meshes, then restores after gap growth", () => {
  const stage = new Stage(frames);
  stage.setPixelBackgroundThickness(0.3);
  stage.setPixelSpriteThickness(0.3);
  stage.setLayerGap(0.004);
  stage.commitFrame(frames);
  const before = stage.bg.thickness;
  stage.setPixelBackgroundThickness(0);
  stage.setPixelSpriteThickness(0);
  assert.equal(stage.bg.back.visible, false);
  assert.equal(stage.bg.side.visible, false);
  for (const layer of stage.sprites) assert.equal(layer.back.visible || layer.side.visible, false);
  stage.setPixelBackgroundThickness(0.3);
  stage.setPixelSpriteThickness(0.3);
  stage.setLayerGap(0.3);
  assert.ok(stage.bg.thickness > before);
});

test("RGB changes update shared texture without rebuilding geometry", () => {
  const stage = new Stage(frames);
  stage.commitFrame(frames);
  const bg = stage.bg;
  const positionVersion = bg.side.geometry.getAttribute("position").version;
  const textureVersion = bg.front.material.map.version;
  frames.bg[0] = 255;
  stage.commitFrame(frames);
  assert.equal(bg.side.geometry.getAttribute("position").version, positionVersion);
  assert.ok(bg.front.material.map.version > textureVersion);
  const sprite = stage.sprites[1];
  const spriteTextureVersion = sprite.front.material.map.version;
  frames.spriteGroups[1].rgba[0] = 200;
  stage.commitFrame(frames);
  assert.ok(sprite.front.material.map.version > spriteTextureVersion);
});

test("hidden sprite changes are applied when it becomes visible", () => {
  const local = structuredClone(frames);
  local.spriteGroups[1].visible = false;
  local.spriteGroups[1].rgba[3] = 0;
  const stage = new Stage(local);
  const sprite = stage.sprites[1];
  const before = sprite.side.geometry.getAttribute("position").version;
  local.spriteGroups[1].rgba[0] = 90;
  stage.commitFrame(local);
  assert.equal(sprite.side.geometry.getAttribute("position").version, before);
  local.spriteGroups[1].visible = true;
  local.spriteGroups[1].rgba[3] = 255;
  stage.commitFrame(local);
  assert.ok(sprite.side.geometry.getAttribute("position").version > before);
});

test("alpha changes rebuild the always-on pixel geometry", () => {
  const stage = new Stage(frames);
  stage.commitFrame(frames);
  const bg = stage.bg;
  const before = bg.side.geometry.getAttribute("position").version;
  frames.bg[3] = 0;
  stage.commitFrame(frames);
  assert.ok(bg.side.geometry.getAttribute("position").version > before);
});


