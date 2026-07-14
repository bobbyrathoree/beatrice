// Ambient declarations for the AudioWorkletGlobalScope.
//
// TypeScript's lib.dom.d.ts intentionally omits AudioWorklet-scope globals
// (`AudioWorkletProcessor`, `registerProcessor`, `sampleRate`, `currentTime`,
// `currentFrame`) because they only exist inside the worklet realm, not on
// `window`. Our worklet is authored in TS and type-checked by `tsc`, so we
// declare the subset we use here. This file is types-only; it emits nothing.

declare const sampleRate: number;
declare const currentTime: number;
declare const currentFrame: number;

interface AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}

declare const AudioWorkletProcessor: {
  prototype: AudioWorkletProcessor;
  new (options?: unknown): AudioWorkletProcessor;
};

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: unknown) => AudioWorkletProcessor
): void;
