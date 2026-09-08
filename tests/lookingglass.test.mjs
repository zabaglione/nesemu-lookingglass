import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const threeUrl = pathToFileURL(path.resolve("node_modules/three/build/three.module.js")).href;
const source = fs.readFileSync(path.resolve("src/scene/lookingglass.ts"), "utf8");
const outputSource = fs.readFileSync(path.resolve("src/scene/lookingglassOutput.ts"), "utf8");
const outputJs = ts.transpileModule(outputSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;

function target() {
  const listeners = new Map();
  return { addEventListener(t, f) { (listeners.get(t) ?? listeners.set(t, new Set()).get(t)).add(f); }, removeEventListener(t, f) { listeners.get(t)?.delete(f); }, dispatchEvent(e) { for (const f of listeners.get(e.type) ?? []) f(e); } };
}

async function loadCase({ serial = "test", requestError = null, setSessionError = null, popupBlocked = false, delayedScreens = false, rejectScreens = false, rejectFullscreenOnce = false } = {}) {
  const sdk = `data:text/javascript;base64,${Buffer.from(`const t=globalThis.__lkg;export const LookingGlassConfig=t.config;export class LookingGlassWebXRPolyfill{constructor(){this.device=t.device;globalThis.navigator.xr={requestSession:(...a)=>this.device.requestSession(...a)}}}`).toString("base64")}#${Math.random()}`;
  const math = `data:text/javascript;base64,${Buffer.from(`export const fitTargetDiam=(w,h,sw,sh,m=1.15)=>Math.max(h,w/(sw/sh))*m;`).toString("base64")}`;
  const output = `data:text/javascript;base64,${Buffer.from(outputJs).toString("base64")}#${Math.random()}`;
  const calls = { open: 0, move: [], fullscreen: [], resizeListeners: 0, fullscreenListeners: 0 };
  let resolveScreens; let rejectDetails;
  const screensPromise = new Promise((resolve, reject) => { resolveScreens = resolve; rejectDetails = reject; });
  const children = []; const body = Object.assign(target(), { style: {}, append() {}, appendChild(node) { children.push(node); node.parentElement = body; }, removeChild() {}, querySelectorAll: () => [], querySelector: (selector) => selector === "button" ? children.find((node) => node.tagName === "BUTTON") : undefined });
  const popup = target(); popup.closed = false; popup.moveTo = (x, y) => calls.move.push([x, y]); popup.resizeTo = () => {}; popup.close = () => { popup.closed = true; popup.dispatchEvent({ type: "pagehide" }); }; popup.document = { body, title: "", visibilityState: "visible", fullscreenElement: null, createElement: (tag) => Object.assign(target(), { tagName: tag.toUpperCase(), style: {}, click() { this.dispatchEvent({ type: "click" }); } }), documentElement: { requestFullscreen: async (options) => { calls.fullscreen.push(options); if (rejectFullscreenOnce) { rejectFullscreenOnce = false; throw new Error("denied"); } popup.document.fullscreenElement = popup.document.documentElement; } } }; popup.navigator = {};
  const originalAdd = popup.addEventListener; const originalRemove = popup.removeEventListener; popup.addEventListener = (type, fn) => { if (type === "resize") calls.resizeListeners++; originalAdd.call(popup, type, fn); }; popup.removeEventListener = (type, fn) => { if (type === "resize") calls.resizeListeners--; originalRemove.call(popup, type, fn); };
  const win = target(); win.closed = false; win.document = { body: Object.assign(target(), { style: {}, append() {}, querySelectorAll: () => [] }), documentElement: { requestFullscreen: async () => {} }, visibilityState: "visible" }; win.navigator = {}; win.requestAnimationFrame = (f) => setTimeout(() => f(performance.now()), 0); win.cancelAnimationFrame = clearTimeout; win.setTimeout = setTimeout; win.clearTimeout = clearTimeout; win.open = () => { calls.open++; return popupBlocked ? null : popup; }; if (delayedScreens || rejectScreens) win.getScreenDetails = () => rejectScreens ? Promise.reject(new Error("permission")) : screensPromise;
  globalThis.window = win; Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true }); globalThis.document = { body: { append() {} }, createElement: () => ({ setAttribute() {}, addEventListener() {}, ownerDocument: globalThis.document }) };
  const canvas = Object.assign(target(), { style: {} }); canvas.ownerDocument = globalThis.document;
  const config = { trackballX: 0, trackballY: 0, targetX: 0, targetY: 0, targetZ: 0, targetDiam: 1, depthiness: 1.25, inlineView: 1, numViews: 8, calibration: { serial, screenW: { value: 3840 }, screenH: { value: 2160 } }, popup: null, lkgCanvas: canvas, updateViewControls() {}, addEventListener() {}, removeEventListener() {} };
  const session = target(); session.end = async () => { session.ended = true; session.dispatchEvent({ type: "end" }); };
  const device = { requestAnimationFrame: (f) => setTimeout(() => f(performance.now()), 0), cancelAnimationFrame: clearTimeout, requestSession: async () => { if (requestError) throw requestError; return session; }, onBaseLayerSet() {}, onFrameEnd() {} };
  globalThis.__lkg = { config, device };
  const text = source.replaceAll('from "three"', `from "${threeUrl}"`).replace('from "@lookingglass/webxr"', `from "${sdk}"`).replace('from "./stereoMath"', `from "${math}"`);
  const withOutput = text.replace('from "./lookingglassOutput"', `from "${output}"`);
  const js = ts.transpileModule(withOutput, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}#${Math.random()}`);
  mod.initLookingGlass(canvas);
  const renderer = { xr: { isPresenting: false, session: null, getSession: () => renderer.xr.session, setSession: async (s) => { if (setSessionError) throw setSessionError; renderer.xr.session = s; renderer.xr.isPresenting = true; }, getBaseLayer: () => null }, getContext: () => ({ isContextLost: () => false }) };
  return { mod, renderer, config, session, popup, calls, resolveScreens, rejectScreens };
}

test("snapshot verifies focal zero and signed real-view disparity", async () => {
  const { mod } = await loadCase(); const THREE = await import(threeUrl);
  const left = new THREE.PerspectiveCamera(35, 1, .01, 10); const right = new THREE.PerspectiveCamera(35, 1, .01, 10); left.position.set(-.1, 0, 2); right.position.set(.1, 0, 2); left.updateMatrixWorld(true); right.updateMatrixWorld(true);
  const f = 1 / Math.tan(THREE.MathUtils.degToRad(17.5)); left.projectionMatrix.elements[8] = -f * left.position.x / 2; right.projectionMatrix.elements[8] = -f * right.position.x / 2;
  const array = new THREE.ArrayCamera([left, right]); const snapshot = mod.getLookingGlassDisplaySnapshot({ xr: { isPresenting: true, getCamera: () => array } }, left);
  const project = (c, z) => new THREE.Vector4(0, 0, z, 1).applyMatrix4(c.matrixWorldInverse).applyMatrix4(c.projectionMatrix); const a = project(left, 0); const b = project(right, 0);
  assert.ok(Math.abs(a.x / a.w - b.x / b.w) < 1e-10); assert.equal(snapshot.actualViewCount, 2); assert.notEqual(Math.sign(snapshot.frontDisparity), Math.sign(snapshot.backDisparity)); assert.notEqual(snapshot.frontDisparity, 0); assert.notEqual(snapshot.backDisparity, 0);
});

test("toggle rejects missing calibration before popup", async () => { const { mod, renderer, config } = await loadCase({ serial: "" }); await assert.rejects(() => mod.toggleLookingGlass(renderer), /校正情報/); assert.equal(config.popup, null); });
test("toggle cleans popup blocked and request failures", async () => { for (const o of [{ popupBlocked: true }, { requestError: new Error("request") }]) { const { mod, renderer, config, session } = await loadCase(o); await assert.rejects(() => mod.toggleLookingGlass(renderer)); assert.equal(config.popup, null); assert.equal(session.ended ?? false, false); } });
test("toggle cleans setSession failure", async () => { const { mod, renderer, config, session } = await loadCase({ setSessionError: new Error("set") }); await assert.rejects(() => mod.toggleLookingGlass(renderer)); assert.equal(session.ended, true); assert.equal(config.popup, null); });
test("successful end and popup pagehide clean session", async () => { for (const pagehide of [false, true]) { const { mod, renderer, config, session } = await loadCase(); assert.equal(await mod.toggleLookingGlass(renderer), true); if (pagehide) config.popup.dispatchEvent({ type: "pagehide" }); else await session.end(); assert.equal(session.ended, true); assert.equal(config.popup, null); } });

test("late screen detection repositions the existing popup and uses the selected screen", async () => {
  const state = await loadCase({ delayedScreens: true, rejectFullscreenOnce: true });
  assert.equal(await state.mod.toggleLookingGlass(state.renderer), true);
  assert.equal(state.calls.open, 1);
  state.resolveScreens({ screens: [{ label: "Looking Glass", left: -2560, top: 0, width: 1920, height: 1080, devicePixelRatio: 2 }] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(state.calls.move[0], [-2560, 0]);
  assert.equal(state.calls.fullscreen[0].screen.left, -2560);
  const button = state.popup.document.body.querySelector?.("button");
  assert.ok(button);
  await button.click();
  assert.equal(state.calls.fullscreen.length, 2);
  assert.equal(state.calls.fullscreen[1].screen.left, -2560);
});

test("screen-details rejection keeps popup and uses fullscreen options without screen", async () => {
  const state = await loadCase({ rejectScreens: true, rejectFullscreenOnce: true });
  assert.equal(await state.mod.toggleLookingGlass(state.renderer), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(state.config.popup.closed, false);
  const button = state.popup.document.body.querySelector?.("button");
  assert.ok(button);
  await button.click();
  assert.equal(state.calls.fullscreen.length, 1);
  assert.equal(Object.hasOwn(state.calls.fullscreen[0], "screen"), false);
});

test("late screen resolution after session end does not move or fullscreen", async () => {
  const state = await loadCase({ delayedScreens: true });
  assert.equal(await state.mod.toggleLookingGlass(state.renderer), true);
  await state.session.end();
  assert.equal(state.calls.resizeListeners, 0);
  const moveCount = state.calls.move.length; const fullscreenCount = state.calls.fullscreen.length;
  state.resolveScreens({ screens: [{ label: "Looking Glass", left: -2560, top: 0, width: 1920, height: 1080, devicePixelRatio: 2 }] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(state.calls.move.length, moveCount);
  assert.equal(state.calls.fullscreen.length, fullscreenCount);
});
