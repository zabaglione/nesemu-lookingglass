// @lookingglass/webxr は型定義のエントリをexportsに含まないため、
// 使用箇所に必要な最小限の型をここで宣言する。
declare module "@lookingglass/webxr" {
  /** カメラ・quilt設定(実体はdist/LookingGlassConfig.d.tsを参照) */
  export interface ViewControlArgs {
    tileHeight: number;
    numViews: number;
    trackballX: number;
    trackballY: number;
    targetX: number;
    targetY: number;
    targetZ: number;
    targetDiam: number;
    fovy: number;
    depthiness: number;
    inlineView: number;
  }

  export class LookingGlassWebXRPolyfill {
    constructor(cfg?: Partial<ViewControlArgs>);
    static init(cfg?: Partial<ViewControlArgs>): Promise<void>;
    update(cfg: Partial<ViewControlArgs>): void;
    isPresenting: boolean;
  }

  export const LookingGlassConfig: ViewControlArgs;
}
