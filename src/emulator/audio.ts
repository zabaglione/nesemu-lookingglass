// NESの音声出力。jsnesのonAudioSampleで受け取ったサンプルを
// AudioWorklet内のリングバッファへ送って再生する。
// (SharedArrayBufferを使わずpostMessageで送るため、静的ホスティングで動く)

const CHUNK_SIZE = 512;

// リング容量 ≒ 85ms @48kHz。満杯時は捨てて遅延の蓄積を防ぐ。
const WORKLET_SOURCE = `
class NesAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = 4096;
    this.bufL = new Float32Array(this.capacity);
    this.bufR = new Float32Array(this.capacity);
    this.readPos = 0;
    this.writePos = 0;
    this.lastL = 0;
    this.lastR = 0;
    this.port.onmessage = (e) => {
      const { l, r } = e.data;
      for (let i = 0; i < l.length; i++) {
        const next = (this.writePos + 1) % this.capacity;
        if (next === this.readPos) break; // 満杯: 以降は捨てる
        this.bufL[this.writePos] = l[i];
        this.bufR[this.writePos] = r[i];
        this.writePos = next;
      }
    };
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out.length > 1 ? out[1] : out[0];
    for (let i = 0; i < L.length; i++) {
      if (this.readPos !== this.writePos) {
        this.lastL = this.bufL[this.readPos];
        this.lastR = this.bufR[this.readPos];
        this.readPos = (this.readPos + 1) % this.capacity;
      } else {
        // アンダーラン: 直前のサンプルを減衰させてクリックノイズを防ぐ
        this.lastL *= 0.97;
        this.lastR *= 0.97;
      }
      L[i] = this.lastL;
      R[i] = this.lastR;
    }
    return true;
  }
}
registerProcessor("nes-audio", NesAudioProcessor);
`;

export const NES_SAMPLE_RATE = 48000;

export class NesAudio {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private starting: Promise<void> | null = null;

  private chunkL = new Float32Array(CHUNK_SIZE);
  private chunkR = new Float32Array(CHUNK_SIZE);
  private chunkLen = 0;

  private volume = 0.5;

  /** ユーザー操作(ROM読み込み等)を起点に呼ぶこと(自動再生制限のため) */
  ensureStarted(): Promise<void> {
    if (this.starting) {
      void this.ctx?.resume();
      return this.starting;
    }
    this.starting = (async () => {
      let ctx: AudioContext;
      try {
        ctx = new AudioContext({ sampleRate: NES_SAMPLE_RATE });
      } catch {
        // sampleRate指定に未対応のブラウザではリサンプリングされる
        ctx = new AudioContext();
      }
      this.ctx = ctx;
      const blob = new Blob([WORKLET_SOURCE], { type: "text/javascript" });
      const url = URL.createObjectURL(blob);
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      this.node = new AudioWorkletNode(ctx, "nes-audio", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.gain = ctx.createGain();
      this.gain.gain.value = this.volume;
      this.node.connect(this.gain).connect(ctx.destination);
      await ctx.resume();
    })();
    return this.starting;
  }

  /** jsnesのonAudioSampleから毎サンプル呼ばれる */
  pushSample = (left: number, right: number): void => {
    if (!this.node) return;
    this.chunkL[this.chunkLen] = left;
    this.chunkR[this.chunkLen] = right;
    this.chunkLen++;
    if (this.chunkLen >= CHUNK_SIZE) {
      this.flush();
    }
  };

  private flush(): void {
    if (!this.node || this.chunkLen === 0) return;
    const l = this.chunkL.slice(0, this.chunkLen);
    const r = this.chunkR.slice(0, this.chunkLen);
    this.node.port.postMessage({ l, r }, [l.buffer, r.buffer]);
    this.chunkLen = 0;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.gain) {
      this.gain.gain.value = v;
    }
  }
}
