// audio.js — WebAudio chiptune synth: looping music + SFX, zero asset files.
//
// Everything is synthesized (square/triangle oscillators + noise bursts) in the
// GB/GBA spirit. The AudioContext can only start after a user gesture, so
// init() is wired to the first keydown/pointerdown; until then all calls are
// no-ops. Mute (M key) persists in localStorage.

const MUTE_KEY = 'jg_creature_game_muted';

const state = {
  ctx: null,
  musicGain: null,
  sfxGain: null,
  muted: false,
  track: null, // current track name
  pendingTrack: null, // requested before ctx existed
  step: 0,
  nextTime: 0,
  timer: null,
  liveNodes: [],
};

try { state.muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* ignore */ }

// ---- Tracks ----------------------------------------------------------------
// Notes are [midi, sixteenths]; midi 0 = rest. lead = square, bass = triangle.

const TRACKS = {
  title: {
    bpm: 100,
    lead: [[69, 2], [72, 2], [76, 2], [72, 2], [71, 2], [69, 2], [67, 2], [69, 2],
           [65, 2], [69, 2], [72, 2], [69, 2], [67, 4], [64, 4]],
    bass: [[45, 4], [41, 4], [43, 4], [45, 4], [41, 4], [38, 4], [43, 4], [45, 4]],
  },
  overworld: {
    bpm: 126,
    lead: [[60, 2], [64, 2], [67, 2], [64, 2], [69, 2], [67, 2], [64, 2], [60, 2],
           [62, 2], [65, 2], [69, 2], [65, 2], [67, 4], [0, 4]],
    bass: [[36, 2], [43, 2], [36, 2], [43, 2], [38, 2], [45, 2], [38, 2], [45, 2],
           [41, 2], [48, 2], [41, 2], [48, 2], [43, 4], [43, 4]],
  },
  battle: {
    bpm: 160,
    lead: [[57, 1], [57, 1], [60, 2], [57, 1], [57, 1], [62, 2], [60, 1], [59, 1], [57, 2], [55, 2], [57, 2],
           [57, 1], [57, 1], [60, 2], [57, 1], [57, 1], [64, 2], [62, 1], [60, 1], [59, 2], [62, 2], [59, 2]],
    bass: [[33, 1], [33, 1], [33, 1], [33, 1], [33, 1], [33, 1], [33, 1], [33, 1],
           [31, 1], [31, 1], [31, 1], [31, 1], [28, 1], [28, 1], [31, 1], [31, 1]],
  },
  evolve: {
    bpm: 132,
    lead: [[72, 1], [76, 1], [79, 1], [84, 1], [79, 1], [76, 1], [72, 2],
           [74, 1], [78, 1], [81, 1], [86, 1], [81, 1], [78, 1], [74, 2]],
    bass: [[48, 4], [48, 4], [50, 4], [50, 4]],
  },
};

// ---- Core ------------------------------------------------------------------

function midiHz(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function initAudio() {
  if (state.ctx) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    state.ctx = new Ctx();
    state.musicGain = state.ctx.createGain();
    state.sfxGain = state.ctx.createGain();
    state.musicGain.connect(state.ctx.destination);
    state.sfxGain.connect(state.ctx.destination);
    applyMute();
    if (state.pendingTrack) {
      const t = state.pendingTrack;
      state.pendingTrack = null;
      playMusic(t);
    }
  } catch { /* audio unavailable — stay silent */ }
}

function applyMute() {
  if (!state.ctx) return;
  state.musicGain.gain.value = state.muted ? 0 : 0.12;
  state.sfxGain.gain.value = state.muted ? 0 : 0.25;
}

export function toggleMute() {
  state.muted = !state.muted;
  try { localStorage.setItem(MUTE_KEY, state.muted ? '1' : '0'); } catch { /* ignore */ }
  applyMute();
  return state.muted;
}

export function isMuted() {
  return state.muted;
}

function spawnNote(freq, when, dur, type, dest, vol = 1) {
  const ctx = state.ctx;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(vol, when + 0.01);
  g.gain.setValueAtTime(vol, Math.max(when + 0.01, when + dur - 0.03));
  g.gain.linearRampToValueAtTime(0.0001, when + dur);
  osc.connect(g);
  g.connect(dest);
  osc.start(when);
  osc.stop(when + dur + 0.02);
  return osc;
}

// ---- Music sequencer ---------------------------------------------------------

function stopMusicNodes() {
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
  for (const n of state.liveNodes) { try { n.stop(); } catch { /* already done */ } }
  state.liveNodes = [];
}

export function playMusic(name) {
  if (name === state.track) return;
  state.track = name;
  if (!state.ctx) { state.pendingTrack = name; return; }
  stopMusicNodes();
  if (!name || !TRACKS[name]) return;

  const track = TRACKS[name];
  const stepDur = 60 / track.bpm / 4; // one sixteenth
  // Expand [note,len] lists to absolute step timelines per channel.
  const channels = [
    { notes: track.lead, type: 'square', vol: 0.5, idx: 0, at: 0, total: track.lead.reduce((s, n) => s + n[1], 0) },
    { notes: track.bass, type: 'triangle', vol: 0.8, idx: 0, at: 0, total: track.bass.reduce((s, n) => s + n[1], 0) },
  ];
  state.step = 0; // absolute 16th-note counter; each channel loops on its own length
  state.nextTime = state.ctx.currentTime + 0.05;

  const scheduleAhead = () => {
    if (state.track !== name || !state.ctx) return;
    const horizon = state.ctx.currentTime + 0.35;
    while (state.nextTime < horizon) {
      for (const ch of channels) {
        // does a note in this channel start at this step (per-channel loop)?
        if (state.step % ch.total === ch.at) {
          const [midi, len] = ch.notes[ch.idx];
          if (midi > 0) {
            const osc = spawnNote(midiHz(midi), state.nextTime, len * stepDur * 0.9, ch.type, state.musicGain, ch.vol);
            state.liveNodes.push(osc);
            if (state.liveNodes.length > 64) state.liveNodes.splice(0, 32);
          }
          ch.at = (ch.at + len) % ch.total;
          ch.idx = (ch.idx + 1) % ch.notes.length;
        }
      }
      state.step += 1;
      state.nextTime += stepDur;
    }
  };
  scheduleAhead();
  state.timer = setInterval(scheduleAhead, 120);
}

// ---- SFX ---------------------------------------------------------------------

function noiseBurst(when, dur, vol, filterHz) {
  const ctx = state.ctx;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = filterHz;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(filter);
  filter.connect(g);
  g.connect(state.sfxGain);
  src.start(when);
}

export function playSfx(name) {
  if (!state.ctx) return;
  const t = state.ctx.currentTime;
  switch (name) {
    case 'confirm':
      spawnNote(880, t, 0.06, 'square', state.sfxGain, 0.4);
      break;
    case 'hit':
      noiseBurst(t, 0.12, 0.7, 900);
      break;
    case 'superhit':
      noiseBurst(t, 0.18, 0.9, 700);
      spawnNote(90, t, 0.16, 'square', state.sfxGain, 0.6);
      break;
    case 'weakhit':
      noiseBurst(t, 0.08, 0.4, 1600);
      break;
    case 'faint': {
      const osc = spawnNote(400, t, 0.45, 'square', state.sfxGain, 0.5);
      osc.frequency.exponentialRampToValueAtTime(70, t + 0.42);
      break;
    }
    case 'catch':
      spawnNote(660, t, 0.05, 'square', state.sfxGain, 0.45);
      spawnNote(660, t + 0.35, 0.05, 'square', state.sfxGain, 0.45);
      spawnNote(660, t + 0.7, 0.05, 'square', state.sfxGain, 0.45);
      break;
    case 'caught':
      [523, 659, 784].forEach((f, i) => spawnNote(f, t + i * 0.09, 0.2, 'square', state.sfxGain, 0.4));
      break;
    case 'level':
      [523, 659, 784, 1047].forEach((f, i) => spawnNote(f, t + i * 0.08, 0.12, 'square', state.sfxGain, 0.45));
      break;
    case 'heal':
      [659, 784, 988].forEach((f, i) => spawnNote(f, t + i * 0.1, 0.14, 'triangle', state.sfxGain, 0.6));
      break;
    default:
      break;
  }
}
