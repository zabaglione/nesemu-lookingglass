export type LookingGlassScreen = {
  label?: string;
  left: number;
  top: number;
  width: number;
  height: number;
  devicePixelRatio?: number;
};

let cachedScreens: LookingGlassScreen[] | null = null;
let screenDetailsPromise: Promise<LookingGlassScreen[]> | null = null;

export function chooseLookingGlassScreen(
  screens: LookingGlassScreen[],
  calibrationWidth: number,
  calibrationHeight: number,
  devicePixelRatio: number,
): LookingGlassScreen | null {
  const named = screens.filter((screen) => /looking\s*glass|lkg/i.test(screen.label ?? ""));
  if (named.length === 1) return named[0];
  const candidates = named.length > 0 ? named : screens;
  const matches = candidates.filter(
    (screen) =>
      Math.round(screen.width * (screen.devicePixelRatio ?? devicePixelRatio)) === calibrationWidth &&
      Math.round(screen.height * (screen.devicePixelRatio ?? devicePixelRatio)) === calibrationHeight,
  );
  return matches.length === 1 ? matches[0] : null;
}

export function canvasCssSize(calibrationWidth: number, calibrationHeight: number, dpr: number): { width: number; height: number } {
  const safeDpr = dpr > 0 ? dpr : 1;
  return { width: calibrationWidth / safeDpr, height: calibrationHeight / safeDpr };
}

export function pixelExactStatus(
  innerWidth: number,
  innerHeight: number,
  dpr: number,
  calibrationWidth: number,
  calibrationHeight: number,
  fullscreen: boolean,
): { pixelExact: boolean; message: string } {
  const exact = fullscreen && Math.round(innerWidth * dpr) === calibrationWidth && Math.round(innerHeight * dpr) === calibrationHeight;
  return { pixelExact: exact, message: exact ? "fullscreen pixel exact" : fullscreen ? "fullscreen size differs from calibration" : "windowed output; use fullscreen" };
}

export async function getLookingGlassScreens(): Promise<LookingGlassScreen[]> {
  if (cachedScreens) return cachedScreens;
  if (!screenDetailsPromise) {
    const getter = (window as Window & { getScreenDetails?: () => Promise<{ screens: LookingGlassScreen[] }> }).getScreenDetails;
    screenDetailsPromise = getter ? getter.call(window).then((details) => {
      cachedScreens = details.screens ?? [];
      (details as unknown as { addEventListener?: (type: string, listener: () => void) => void }).addEventListener?.("screenschange", () => {
        cachedScreens = null;
      });
      return cachedScreens;
    }).finally(() => { screenDetailsPromise = null; }) : Promise.resolve([]);
  }
  try { return await screenDetailsPromise; } catch { return []; }
}

export function prefetchLookingGlassScreens(): void {
  const permissions = (navigator as Navigator & { permissions?: Permissions }).permissions;
  if (!permissions?.query) return;
  void permissions.query({ name: "window-management" } as unknown as PermissionDescriptor).then((status) => {
    if (status.state === "granted") void getLookingGlassScreens();
  }).catch(() => undefined);
}

export function getCachedLookingGlassScreens(): LookingGlassScreen[] | null { return cachedScreens; }

export function resetLookingGlassScreenCache(): void { cachedScreens = null; screenDetailsPromise = null; }

export function placeOutputWindow(popup: Window, screen: LookingGlassScreen): void {
  popup.moveTo(screen.left, screen.top);
  popup.resizeTo(screen.width, screen.height);
}
