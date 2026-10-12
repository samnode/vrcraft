// Tiny synthesised sound set. No audio files to download, and the AudioContext is
// created lazily so it starts on the first user gesture as browsers require.

let ctx = null;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone({ freq = 220, type = 'square', duration = 0.08, gain = 0.12, sweep = 0 }) {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ac.currentTime);
  if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), ac.currentTime + duration);
  amp.gain.setValueAtTime(gain, ac.currentTime);
  amp.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);
  osc.connect(amp).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + duration + 0.02);
}

function noise({ duration = 0.12, gain = 0.1, cutoff = 900 }) {
  const ac = audio();
  if (!ac) return;
  const frames = Math.floor(ac.sampleRate * duration);
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  const amp = ac.createGain();
  amp.gain.value = gain;
  src.connect(filter).connect(amp).connect(ac.destination);
  src.start();
}

export const sfx = {
  resume: () => audio(),
  dig:    () => noise({ duration: 0.07, gain: 0.05, cutoff: 700 }),
  break:  () => { noise({ duration: 0.18, gain: 0.12, cutoff: 1400 }); tone({ freq: 150, duration: 0.1, gain: 0.05, sweep: -60 }); },
  place:  () => tone({ freq: 320, type: 'triangle', duration: 0.07, gain: 0.1, sweep: -80 }),
  hit:    () => tone({ freq: 180, type: 'sawtooth', duration: 0.09, gain: 0.1, sweep: -70 }),
  hurt:   () => tone({ freq: 440, type: 'sawtooth', duration: 0.18, gain: 0.12, sweep: -260 }),
  pickup: () => tone({ freq: 660, type: 'triangle', duration: 0.07, gain: 0.08, sweep: 220 }),
  eat:    () => noise({ duration: 0.2, gain: 0.07, cutoff: 500 }),
};
