const noteNames = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

const intervalMap = {
  unison: { label: "Unison", semitones: [0] },
  fifthBelow: { label: "Fifth below", semitones: [-7] },
  octaveBelow: { label: "Octave below", semitones: [-12] },
  fourthBelow: { label: "Fourth below", semitones: [-5] }
};

const ui = {
  startButton: document.getElementById("startButton"),
  clearButton: document.getElementById("clearButton"),
  sessionBadge: document.getElementById("sessionBadge"),
  audioBadge: document.getElementById("audioBadge"),
  lockState: document.getElementById("lockState"),
  targetNote: document.getElementById("targetNote"),
  targetSubnote: document.getElementById("targetSubnote"),
  droneTargetText: document.getElementById("droneTargetText"),
  heardNoteText: document.getElementById("heardNoteText"),
  historyChips: document.getElementById("historyChips"),
  graphSummary: document.getElementById("graphSummary"),
  noteHistoryGrid: document.getElementById("noteHistoryGrid"),
  tunerCents: document.getElementById("tunerCents"),
  tunerNeedle: document.getElementById("tunerNeedle"),
  tunerCaption: document.getElementById("tunerCaption"),
  confidenceText: document.getElementById("confidenceText"),
  liveFrequency: document.getElementById("liveFrequency"),
  liveDisplayNote: document.getElementById("liveDisplayNote"),
  instrumentSelect: document.getElementById("instrumentSelect"),
  intervalSelect: document.getElementById("intervalSelect"),
  stabilitySlider: document.getElementById("stabilitySlider"),
  stabilityValue: document.getElementById("stabilityValue"),
  glideSlider: document.getElementById("glideSlider"),
  glideValue: document.getElementById("glideValue"),
  mixSlider: document.getElementById("mixSlider"),
  mixValue: document.getElementById("mixValue"),
  droneToggle: document.getElementById("droneToggle")
};

const state = {
  audioContext: null,
  analyser: null,
  analysisBuffer: null,
  mediaStream: null,
  sourceNode: null,
  drone: null,
  rafId: 0,
  instrumentTranspose: Number(ui.instrumentSelect.value),
  intervalMode: ui.intervalSelect.value,
  stabilityMs: Number(ui.stabilitySlider.value),
  glideMs: Number(ui.glideSlider.value),
  mix: Number(ui.mixSlider.value) / 100,
  droneEnabled: ui.droneToggle.checked,
  candidate: null,
  lockedMidi: null,
  lockedFreq: null,
  history: [],
  noteHistory: {},
  noteHistoryOrder: [],
  noteHistoryDirty: true,
  lastHistorySampleAt: 0,
  liveDetection: null,
  lastDetectionAt: 0,
  sessionStarted: false
};

class DroneEngine {
  constructor(context) {
    this.context = context;
    this.master = context.createGain();
    this.master.gain.value = 0;

    this.lowpass = context.createBiquadFilter();
    this.lowpass.type = "lowpass";
    this.lowpass.frequency.value = 1100;
    this.lowpass.Q.value = 0.8;

    this.highpass = context.createBiquadFilter();
    this.highpass.type = "highpass";
    this.highpass.frequency.value = 80;
    this.highpass.Q.value = 0.5;

    this.master.connect(this.lowpass);
    this.lowpass.connect(this.highpass);
    this.highpass.connect(context.destination);

    this.voices = Array.from({ length: 2 }, () => this.createVoice());
  }

  createVoice() {
    const primary = this.context.createOscillator();
    primary.type = "sine";

    const bloom = this.context.createOscillator();
    bloom.type = "triangle";
    bloom.detune.value = 3.5;

    const voiceGain = this.context.createGain();
    const bloomGain = this.context.createGain();
    const mixGain = this.context.createGain();

    voiceGain.gain.value = 0;
    bloomGain.gain.value = 0;
    mixGain.gain.value = 0;

    primary.connect(voiceGain);
    bloom.connect(bloomGain);
    voiceGain.connect(mixGain);
    bloomGain.connect(mixGain);
    mixGain.connect(this.master);

    primary.start();
    bloom.start();

    return { primary, bloom, voiceGain, bloomGain, mixGain };
  }

  setEnabled(enabled, mix) {
    const target = enabled ? mix : 0;
    this.master.gain.setTargetAtTime(target, this.context.currentTime, 0.08);
  }

  setMix(mix) {
    const target = state.droneEnabled ? mix : 0;
    this.master.gain.setTargetAtTime(target, this.context.currentTime, 0.08);
  }

  setFrequencies(frequencies, glideMs) {
    const glide = Math.max(glideMs / 1000, 0.05);

    this.voices.forEach((voice, index) => {
      const freq = frequencies[index];
      if (!freq) {
        voice.mixGain.gain.setTargetAtTime(0, this.context.currentTime, 0.06);
        return;
      }

      voice.primary.frequency.cancelScheduledValues(this.context.currentTime);
      voice.bloom.frequency.cancelScheduledValues(this.context.currentTime);
      voice.primary.frequency.setTargetAtTime(freq, this.context.currentTime, glide * 0.45);
      voice.bloom.frequency.setTargetAtTime(freq * 2, this.context.currentTime, glide * 0.45);

      voice.voiceGain.gain.setTargetAtTime(0.48 / (index + 1), this.context.currentTime, 0.08);
      voice.bloomGain.gain.setTargetAtTime(0.13 / (index + 1), this.context.currentTime, 0.08);
      voice.mixGain.gain.setTargetAtTime(1, this.context.currentTime, 0.08);
    });
  }
}

function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function frequencyToMidiFloat(frequency) {
  return 69 + 12 * Math.log2(frequency / 440);
}

function formatNoteName(midi, transpose = 0) {
  if (midi === null || midi === undefined || Number.isNaN(midi)) {
    return "--";
  }

  const adjusted = midi + transpose;
  const rounded = Math.round(adjusted);
  const octave = Math.floor(rounded / 12) - 1;
  const note = noteNames[((rounded % 12) + 12) % 12];
  return `${note}${octave}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function centsText(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-- cents";
  }

  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded} cents`;
}

function average(values) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function describeConfidence(confidence) {
  if (!confidence) {
    return "Confidence --";
  }

  return `Confidence ${Math.round(confidence * 100)}%`;
}

function detectPitchYin(buffer, sampleRate, minFrequency = 160, maxFrequency = 1200) {
  const length = buffer.length;
  let rms = 0;

  for (let i = 0; i < length; i += 1) {
    const sample = buffer[i];
    rms += sample * sample;
  }

  rms = Math.sqrt(rms / length);
  if (rms < 0.012) {
    return null;
  }

  const tauMin = Math.max(2, Math.floor(sampleRate / maxFrequency));
  const tauMax = Math.min(Math.floor(sampleRate / minFrequency), length - 2);
  const yin = new Float32Array(tauMax + 1);

  for (let tau = tauMin; tau <= tauMax; tau += 1) {
    let delta = 0;
    for (let i = 0; i < length - tau; i += 1) {
      const diff = buffer[i] - buffer[i + tau];
      delta += diff * diff;
    }
    yin[tau] = delta;
  }

  let runningSum = 0;
  yin[0] = 1;
  for (let tau = tauMin; tau <= tauMax; tau += 1) {
    runningSum += yin[tau];
    yin[tau] = runningSum === 0 ? 1 : (yin[tau] * tau) / runningSum;
  }

  const threshold = 0.12;
  let bestTau = -1;
  for (let tau = tauMin; tau <= tauMax; tau += 1) {
    if (yin[tau] < threshold) {
      while (tau + 1 <= tauMax && yin[tau + 1] < yin[tau]) {
        tau += 1;
      }
      bestTau = tau;
      break;
    }
  }

  if (bestTau === -1) {
    let bestValue = 1;
    for (let tau = tauMin; tau <= tauMax; tau += 1) {
      if (yin[tau] < bestValue) {
        bestValue = yin[tau];
        bestTau = tau;
      }
    }
  }

  if (bestTau <= 0 || !Number.isFinite(bestTau)) {
    return null;
  }

  const before = bestTau > 1 ? yin[bestTau - 1] : yin[bestTau];
  const center = yin[bestTau];
  const after = bestTau + 1 < yin.length ? yin[bestTau + 1] : yin[bestTau];
  const shift = (after - before) / (2 * (2 * center - after - before));
  const refinedTau = Number.isFinite(shift) ? bestTau + shift : bestTau;
  const frequency = sampleRate / refinedTau;
  const confidence = clamp(1 - center, 0, 1);

  if (!Number.isFinite(frequency) || frequency < minFrequency || frequency > maxFrequency) {
    return null;
  }

  return {
    frequency,
    confidence,
    rms,
    midiFloat: frequencyToMidiFloat(frequency)
  };
}

function getDroneFrequencies(centerMidi) {
  const mode = intervalMap[state.intervalMode] || intervalMap.fifthBelow;
  return mode.semitones.map((offset) => midiToFrequency(centerMidi + offset));
}

function pushHistory(midi) {
  if (state.history[0] === midi) {
    return;
  }

  state.history.unshift(midi);
  state.history = state.history.slice(0, 8);
}

function touchNoteHistoryOrder(midi) {
  state.noteHistoryOrder = state.noteHistoryOrder.filter((value) => value !== midi);
  state.noteHistoryOrder.unshift(midi);
  state.noteHistoryOrder = state.noteHistoryOrder.slice(0, 12);
}

function recordIntonationSample(detection) {
  if (!detection || detection.confidence < 0.8) {
    return;
  }

  const now = performance.now();
  if (now - state.lastHistorySampleAt < 120) {
    return;
  }

  const midi = Math.round(detection.midiFloat);
  const cents = clamp((detection.midiFloat - midi) * 100, -50, 50);

  if (Math.abs(cents) > 45) {
    return;
  }

  if (!state.noteHistory[midi]) {
    state.noteHistory[midi] = [];
  }

  state.noteHistory[midi].push({
    cents,
    timestamp: now,
    confidence: detection.confidence
  });

  state.noteHistory[midi] = state.noteHistory[midi].slice(-72);
  state.lastHistorySampleAt = now;
  state.noteHistoryDirty = true;
  touchNoteHistoryOrder(midi);
}

function updateDroneTarget() {
  if (!state.drone) {
    return;
  }

  if (state.lockedMidi === null) {
    state.drone.setFrequencies([], state.glideMs);
    return;
  }

  state.drone.setFrequencies(getDroneFrequencies(state.lockedMidi), state.glideMs);
  state.drone.setEnabled(state.droneEnabled, state.mix);
}

function setLockedCenter(midi) {
  state.lockedMidi = midi;
  state.lockedFreq = midiToFrequency(midi);
  pushHistory(midi);
  updateDroneTarget();
}

function resetCenter() {
  state.candidate = null;
  state.lockedMidi = null;
  state.lockedFreq = null;
  updateDroneTarget();
  render();
}

function updateCandidate(detection) {
  const now = performance.now();

  if (!detection || detection.confidence < 0.82) {
    if (state.candidate && now - state.candidate.lastSeen > 220) {
      state.candidate = null;
    }
    return;
  }

  const nearestMidi = Math.round(detection.midiFloat);
  const centsFromNearest = (detection.midiFloat - nearestMidi) * 100;

  if (Math.abs(centsFromNearest) > 42) {
    state.candidate = null;
    return;
  }

  if (!state.candidate || state.candidate.midi !== nearestMidi) {
    state.candidate = {
      midi: nearestMidi,
      startedAt: now,
      lastSeen: now,
      count: 1
    };
    return;
  }

  state.candidate.lastSeen = now;
  state.candidate.count += 1;

  if (
    now - state.candidate.startedAt >= state.stabilityMs &&
    state.candidate.count >= 5 &&
    state.lockedMidi !== nearestMidi
  ) {
    setLockedCenter(nearestMidi);
  }
}

function updateLiveDetection(detection) {
  state.liveDetection = detection;
  if (detection) {
    state.lastDetectionAt = performance.now();
    recordIntonationSample(detection);
    updateCandidate(detection);
  } else if (performance.now() - state.lastDetectionAt > 1200) {
    state.liveDetection = null;
  }
}

function animate() {
  if (!state.analyser || !state.analysisBuffer) {
    return;
  }

  state.analyser.getFloatTimeDomainData(state.analysisBuffer);
  updateLiveDetection(detectPitchYin(state.analysisBuffer, state.audioContext.sampleRate));
  render();
  state.rafId = window.requestAnimationFrame(animate);
}

async function startSession() {
  if (state.sessionStarted) {
    await state.audioContext.resume();
    state.drone?.setEnabled(state.droneEnabled, state.mix);
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    ui.audioBadge.textContent = "Browser mic API missing";
    ui.audioBadge.classList.remove("muted");
    ui.audioBadge.classList.add("is-drifted");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContextClass();

    const source = context.createMediaStreamSource(stream);
    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 140;
    highpass.Q.value = 0.6;

    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 1500;
    lowpass.Q.value = 0.7;

    const analyser = context.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0;

    source.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(analyser);

    state.audioContext = context;
    state.mediaStream = stream;
    state.sourceNode = source;
    state.analyser = analyser;
    state.analysisBuffer = new Float32Array(analyser.fftSize);
    state.drone = new DroneEngine(context);
    state.sessionStarted = true;

    updateDroneTarget();
    state.drone.setEnabled(state.droneEnabled, state.mix);

    ui.sessionBadge.textContent = "Session live";
    ui.audioBadge.textContent = "Mic connected";
    ui.audioBadge.classList.remove("muted");
    ui.audioBadge.classList.remove("is-drifted");
    ui.audioBadge.classList.add("is-centered");
    ui.startButton.textContent = "Resume Session";

    if (state.rafId) {
      window.cancelAnimationFrame(state.rafId);
    }
    animate();
  } catch (error) {
    console.error(error);
    ui.audioBadge.textContent = "Mic access denied";
    ui.audioBadge.classList.remove("muted");
    ui.audioBadge.classList.add("is-drifted");
  }
}

function renderHistory() {
  ui.historyChips.innerHTML = "";

  if (!state.history.length) {
    const empty = document.createElement("span");
    empty.className = "history-chip empty";
    empty.textContent = "No locked notes yet";
    ui.historyChips.appendChild(empty);
    return;
  }

  state.history.forEach((midi) => {
    const chip = document.createElement("span");
    chip.className = "history-chip";
    chip.textContent = formatNoteName(midi, state.instrumentTranspose).replace(/[0-9]/g, "");
    ui.historyChips.appendChild(chip);
  });
}

function buildSparklinePath(samples, width, height, maxAbsCents) {
  if (!samples.length) {
    return "";
  }

  return samples
    .map((sample, index) => {
      const x = samples.length === 1 ? width / 2 : (index / (samples.length - 1)) * width;
      const normalized = clamp(sample.cents / maxAbsCents, -1, 1);
      const y = height / 2 - normalized * ((height / 2) - 8);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function createNoteGraphCard(midi, samples) {
  const card = document.createElement("article");
  card.className = "note-graph-card";

  const avgCents = average(samples.map((sample) => sample.cents));
  const latest = samples[samples.length - 1];
  const title = formatNoteName(midi, state.instrumentTranspose).replace(/[0-9]/g, "");
  const subtitle = `Concert ${formatNoteName(midi).replace(/[0-9]/g, "")}`;
  const svgWidth = 180;
  const svgHeight = 88;
  const linePath = buildSparklinePath(samples, svgWidth, svgHeight, 50);

  card.innerHTML = `
    <div class="note-graph-header">
      <div class="note-graph-metric">
        <span class="note-graph-title">${title}</span>
        <span class="note-graph-subtitle">${subtitle}</span>
      </div>
      <span class="note-graph-meta">${samples.length} samples</span>
    </div>
    <svg class="note-graph-svg" viewBox="0 0 ${svgWidth} ${svgHeight}" preserveAspectRatio="none" aria-label="Intonation history for ${title}">
      <line class="note-graph-axis" x1="0" y1="8" x2="${svgWidth}" y2="8"></line>
      <line class="note-graph-center" x1="0" y1="${svgHeight / 2}" x2="${svgWidth}" y2="${svgHeight / 2}"></line>
      <line class="note-graph-axis" x1="0" y1="${svgHeight - 8}" x2="${svgWidth}" y2="${svgHeight - 8}"></line>
      <path class="note-graph-line" d="${linePath}"></path>
    </svg>
    <div class="note-graph-metrics">
      <div class="note-graph-metric">
        <span class="note-graph-meta">Average</span>
        <strong>${centsText(avgCents)}</strong>
      </div>
      <div class="note-graph-metric">
        <span class="note-graph-meta">Latest</span>
        <strong>${centsText(latest?.cents ?? 0)}</strong>
      </div>
    </div>
  `;

  return card;
}

function renderNoteHistoryGraphs() {
  if (!state.noteHistoryDirty) {
    return;
  }

  ui.noteHistoryGrid.innerHTML = "";

  if (!state.noteHistoryOrder.length) {
    const empty = document.createElement("article");
    empty.className = "note-graph-card empty";
    empty.textContent = "Play and hold a few notes to start building note-by-note intonation graphs.";
    ui.noteHistoryGrid.appendChild(empty);
    ui.graphSummary.textContent = "No note data yet";
    state.noteHistoryDirty = false;
    return;
  }

  const ordered = state.noteHistoryOrder
    .filter((midi) => state.noteHistory[midi]?.length)
    .slice(0, 8);

  ordered.forEach((midi) => {
    ui.noteHistoryGrid.appendChild(createNoteGraphCard(midi, state.noteHistory[midi]));
  });

  ui.graphSummary.textContent = `${ordered.length} notes tracked`;
  state.noteHistoryDirty = false;
}

function render() {
  const live = state.liveDetection;
  const liveMidi = live ? live.midiFloat : null;
  const liveRounded = liveMidi !== null ? Math.round(liveMidi) : null;
  const targetMidi = state.lockedMidi !== null ? state.lockedMidi : liveRounded;
  const centsFromTarget = liveMidi !== null && targetMidi !== null ? (liveMidi - targetMidi) * 100 : null;
  const intervalLabel = intervalMap[state.intervalMode].label;

  ui.targetNote.textContent =
    state.lockedMidi !== null
      ? formatNoteName(state.lockedMidi, state.instrumentTranspose).replace(/[0-9]/g, "")
      : "--";
  ui.targetSubnote.textContent =
    state.lockedMidi !== null
      ? `Concert ${formatNoteName(state.lockedMidi).replace(/[0-9]/g, "")}`
      : "Concert --";
  ui.lockState.textContent = state.lockedMidi !== null ? "Locked" : "Waiting";

  ui.droneTargetText.textContent =
    state.lockedMidi !== null
      ? `${intervalLabel} on ${formatNoteName(state.lockedMidi, state.instrumentTranspose).replace(/[0-9]/g, "")}`
      : "No stable tone yet";

  ui.heardNoteText.textContent =
    liveRounded !== null
      ? `${formatNoteName(liveRounded, state.instrumentTranspose).replace(/[0-9]/g, "")} | ${live.frequency.toFixed(1)} Hz`
      : "--";

  ui.liveFrequency.textContent = live ? `${live.frequency.toFixed(1)} Hz` : "-- Hz";
  ui.liveDisplayNote.textContent =
    liveRounded !== null ? formatNoteName(liveRounded, state.instrumentTranspose).replace(/[0-9]/g, "") : "--";

  ui.confidenceText.textContent = describeConfidence(live?.confidence);
  ui.tunerCents.textContent = centsText(centsFromTarget);
  ui.tunerCents.classList.toggle("is-drifted", centsFromTarget !== null && Math.abs(centsFromTarget) > 10);
  ui.tunerCents.classList.toggle("is-centered", centsFromTarget !== null && Math.abs(centsFromTarget) <= 10);

  const clampedCents = centsFromTarget === null ? 0 : clamp(centsFromTarget, -50, 50);
  const offsetPercent = ((clampedCents + 50) / 100) * 100;
  ui.tunerNeedle.style.transform = `translateX(calc(${offsetPercent}% - 13px))`;
  ui.tunerNeedle.style.background =
    centsFromTarget !== null && Math.abs(centsFromTarget) <= 8
      ? "linear-gradient(135deg, #ffffff, #8be3c1)"
      : "linear-gradient(135deg, #ffffff, #f5d28d)";

  ui.tunerCaption.textContent =
    state.lockedMidi !== null
      ? `Tuning against locked center ${formatNoteName(state.lockedMidi, state.instrumentTranspose).replace(/[0-9]/g, "")}.`
      : "Hold one steady pitch to lock the center and move the drone.";

  renderHistory();
  renderNoteHistoryGraphs();
}

function bindControls() {
  ui.startButton.addEventListener("click", startSession);
  ui.clearButton.addEventListener("click", resetCenter);

  ui.instrumentSelect.addEventListener("input", (event) => {
    state.instrumentTranspose = Number(event.target.value);
    state.noteHistoryDirty = true;
    render();
  });

  ui.intervalSelect.addEventListener("input", (event) => {
    state.intervalMode = event.target.value;
    updateDroneTarget();
    render();
  });

  ui.stabilitySlider.addEventListener("input", (event) => {
    state.stabilityMs = Number(event.target.value);
    ui.stabilityValue.textContent = `${state.stabilityMs} ms`;
  });

  ui.glideSlider.addEventListener("input", (event) => {
    state.glideMs = Number(event.target.value);
    ui.glideValue.textContent = `${state.glideMs} ms`;
    updateDroneTarget();
  });

  ui.mixSlider.addEventListener("input", (event) => {
    state.mix = Number(event.target.value) / 100;
    ui.mixValue.textContent = `${Math.round(state.mix * 100)}%`;
    state.drone?.setMix(state.mix);
  });

  ui.droneToggle.addEventListener("change", (event) => {
    state.droneEnabled = event.target.checked;
    state.drone?.setEnabled(state.droneEnabled, state.mix);
  });
}

ui.stabilityValue.textContent = `${state.stabilityMs} ms`;
ui.glideValue.textContent = `${state.glideMs} ms`;
ui.mixValue.textContent = `${Math.round(state.mix * 100)}%`;

bindControls();
render();
