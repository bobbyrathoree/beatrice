import { describe, it, expect, vi, afterEach } from "vitest";
import type { ThemeSound } from "../bindings";
import {
  deriveTimbre,
  renderMetaFromArrangement,
  mulberry32,
  seedFrom,
  DEFAULT_SOUND,
} from "./timbre";

// BLADE RUNNER's sound — SynthwaveDrums + GatedReverb + sustained pads.
const BR_SOUND: ThemeSound = {
  drum_palette: "SynthwaveDrums",
  fx_profile: "GatedReverb",
  pad_sustain: true,
};
// Stranger Things' sound — TR808 + DarkDelay + rhythmic pads.
const ST_SOUND: ThemeSound = {
  drum_palette: "TR808",
  fx_profile: "DarkDelay",
  pad_sustain: false,
};

afterEach(() => {
  vi.restoreAllMocks();
});

// (a) mulberry32 --------------------------------------------------------------
describe("mulberry32", () => {
  it("same seed → same first 8 values", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("different seeds produce different sequences", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it("all values are in [0, 1)", () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

// (b) seedFrom ----------------------------------------------------------------
describe("seedFrom", () => {
  it("equal args → equal seed", () => {
    expect(seedFrom("kick", 1, "bar")).toBe(seedFrom("kick", 1, "bar"));
  });

  it("any changed arg → different seed", () => {
    const base = seedFrom("kick", 1, "bar");
    expect(seedFrom("kick", 2, "bar")).not.toBe(base);
    expect(seedFrom("snare", 1, "bar")).not.toBe(base);
    expect(seedFrom("kick", 1, "baz")).not.toBe(base);
  });

  it("boundary is unambiguous: seedFrom('ab','c') !== seedFrom('a','bc')", () => {
    expect(seedFrom("ab", "c")).not.toBe(seedFrom("a", "bc"));
  });

  it("type is tagged: seedFrom('1') !== seedFrom(1)", () => {
    expect(seedFrom("1")).not.toBe(seedFrom(1));
  });

  it("returns a finite 32-bit unsigned integer", () => {
    const s = seedFrom("x", 42);
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(0xffffffff);
  });
});

// (c) deriveTimbre — BLADE RUNNER @ 90 ---------------------------------------
describe("deriveTimbre(BR_SOUND, 90)", () => {
  const t = deriveTimbre(BR_SOUND, 90);

  it("resolves GatedReverb FX with dotted-eighth delay and gate", () => {
    expect(t.fx.profile).toBe("GatedReverb");
    expect(t.fx.delayTimeSec).toBe(0.5); // 0.75 * 60 / 90
    expect(t.fx.reverbGateSec).toBe(0.28);
  });

  it("uses the SynthwaveDrums kick and sustained pad", () => {
    expect(t.kick.subFreqStartHz).toBe(150);
    expect(t.pad.sustain).toBe(true);
  });

  it("computes renderTailSec = dryOverhang 0.45 + fxRing 2.5 + 0.1", () => {
    // fxRing = max(gate 0.28, delay 0.5 * ceil(ln0.001/ln0.25)=0.5*5=2.5) = 2.5
    expect(t.fx.renderTailSec).toBeCloseTo(3.05, 5);
  });
});

// (d) deriveTimbre — Stranger Things @ 120 -----------------------------------
describe("deriveTimbre(ST_SOUND, 120)", () => {
  const t = deriveTimbre(ST_SOUND, 120);

  it("resolves DarkDelay FX with eighth delay and in-loop lowpass", () => {
    expect(t.fx.delayTimeSec).toBe(0.25); // 0.5 * 60 / 120
    expect(t.fx.delayFilterHz).toBe(1200);
  });

  it("uses the TR808 kick decay and rhythmic pad", () => {
    expect(t.kick.subDecaySec).toBe(0.7);
    expect(t.pad.sustain).toBe(false);
  });

  it("computes renderTailSec = 0.75 + 0.25*9 + 0.1", () => {
    // dryOverhang = kick 0.7+0.05 = 0.75; fxRing = max(reverb 1.2, delay 0.25*9=2.25) = 2.25
    expect(t.fx.renderTailSec).toBeCloseTo(3.1, 5);
  });
});

// (e) bpm clamp ---------------------------------------------------------------
describe("deriveTimbre bpm clamp [40, 300], non-finite/<=0 → 120", () => {
  it("bpm 0 behaves like 120", () => {
    expect(deriveTimbre(BR_SOUND, 0)).toEqual(deriveTimbre(BR_SOUND, 120));
  });

  it("bpm NaN behaves like 120", () => {
    expect(deriveTimbre(BR_SOUND, NaN)).toEqual(deriveTimbre(BR_SOUND, 120));
  });

  it("bpm 1000 clamps to 300", () => {
    expect(deriveTimbre(BR_SOUND, 1000)).toEqual(deriveTimbre(BR_SOUND, 300));
  });
});

// (f) Dry profile tail --------------------------------------------------------
describe("deriveTimbre — Dry profile", () => {
  it("renderTailSec = dryOverhang 0.45 + 0 + 0.1 for SynthwaveDrums", () => {
    const drySound: ThemeSound = {
      drum_palette: "SynthwaveDrums",
      fx_profile: "Dry",
      pad_sustain: true,
    };
    const t = deriveTimbre(drySound, 120);
    expect(t.fx.renderTailSec).toBeCloseTo(0.55, 5);
  });
});

// (g) renderMetaFromArrangement ----------------------------------------------
describe("renderMetaFromArrangement", () => {
  it("passes valid metadata through untouched and does not warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const arr = {
      sound: {
        drum_palette: "TR808",
        fx_profile: "DarkDelay",
        pad_sustain: false,
      },
      bpm: 128,
    };
    const result = renderMetaFromArrangement(arr);
    expect(result.sound).toEqual({
      drum_palette: "TR808",
      fx_profile: "DarkDelay",
      pad_sustain: false,
    });
    expect(result.bpm).toBe(128);
    expect(warn).not.toHaveBeenCalled();
  });

  it("empty object → DEFAULT_SOUND + 120 with a single warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = renderMetaFromArrangement({});
    expect(result.sound).toEqual(DEFAULT_SOUND);
    expect(result.bpm).toBe(120);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("malformed variants → full fallback, one warn, and deriveTimbre never throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const arr = {
      sound: { drum_palette: "Bogus", fx_profile: "DarkDelay", pad_sustain: "yes" },
      bpm: -3,
    };
    const result = renderMetaFromArrangement(arr);
    expect(result.sound).toEqual(DEFAULT_SOUND);
    expect(result.bpm).toBe(120);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(() => deriveTimbre(result.sound, result.bpm)).not.toThrow();
  });

  it("deriveTimbre itself never warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    deriveTimbre(BR_SOUND, 90);
    deriveTimbre(ST_SOUND, 120);
    expect(warn).not.toHaveBeenCalled();
  });
});

// DEFAULT_SOUND ---------------------------------------------------------------
describe("DEFAULT_SOUND", () => {
  it("is BLADE RUNNER's sound", () => {
    expect(DEFAULT_SOUND).toEqual(BR_SOUND);
  });
});
