/**
 * Synthesizes a clean, high-quality notification chime using Web Audio API
 */
export function playChime() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    
    // Resume audio context if suspended (browser security rules)
    if (ctx.state === "suspended") {
      ctx.resume();
    }

    // Bell envelope
    const now = ctx.currentTime;
    
    // First high tone (Root)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(880, now); // A5 note
    gain1.gain.setValueAtTime(0.15, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    
    // Second harmony tone (Major Third)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(1109.73, now + 0.08); // C#6 note
    gain2.gain.setValueAtTime(0.12, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

    // Filter to sweeten
    const filter = ctx.createLowpassFilter ? ctx.createLowpassFilter() : ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1800, now);

    // Connect
    osc1.connect(gain1);
    gain1.connect(filter);

    osc2.connect(gain2);
    gain2.connect(filter);

    filter.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.8);

    osc2.start(now + 0.08);
    osc2.stop(now + 0.8);
  } catch (error) {
    console.warn("Web Audio API trigger blocked standard playback", error);
  }
}
