/**
 * Sound effects (#106, doc 12 §9): pop = XP, chime = Level Up, drum = Boss defeated. Synthesized with WebAudio —
 * no audio assets, no network. Default OFF (Settings → Sounds); volume is user-controlled; calm mode silences all.
 */

export type SoundKind = "pop" | "chime" | "drum";

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(ac: AudioContext, out: GainNode, opts: { type: OscillatorType; from: number; to?: number; at: number; dur: number; gain: number }) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.from, ac.currentTime + opts.at);
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, ac.currentTime + opts.at + opts.dur);
  g.gain.setValueAtTime(0, ac.currentTime + opts.at);
  g.gain.linearRampToValueAtTime(opts.gain, ac.currentTime + opts.at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + opts.at + opts.dur);
  osc.connect(g).connect(out);
  osc.start(ac.currentTime + opts.at);
  osc.stop(ac.currentTime + opts.at + opts.dur + 0.05);
}

export function playSound(kind: SoundKind, volume: number) {
  const ac = audio();
  if (!ac || volume <= 0) return;
  const out = ac.createGain();
  out.gain.value = Math.min(1, Math.max(0, volume));
  out.connect(ac.destination);
  if (kind === "pop") {
    tone(ac, out, { type: "sine", from: 520, to: 940, at: 0, dur: 0.09, gain: 0.5 });
  } else if (kind === "chime") {
    tone(ac, out, { type: "triangle", from: 880, at: 0, dur: 0.35, gain: 0.4 });
    tone(ac, out, { type: "triangle", from: 1318.5, at: 0.12, dur: 0.45, gain: 0.3 });
  } else {
    tone(ac, out, { type: "sine", from: 160, to: 55, at: 0, dur: 0.28, gain: 0.9 });
    tone(ac, out, { type: "square", from: 90, to: 45, at: 0.02, dur: 0.12, gain: 0.25 });
  }
}