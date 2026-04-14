const ui = {
  bootButton: document.getElementById("bootButton"),
  sequenceButton: document.getElementById("sequenceButton"),
  stopSequenceButton: document.getElementById("stopSequenceButton"),
  engineBadge: document.getElementById("engineBadge"),
  phaseBadge: document.getElementById("phaseBadge"),
  loopBadge: document.getElementById("loopBadge"),
  rhythmBadge: document.getElementById("rhythmBadge"),
  phaseText: document.getElementById("phaseText"),
  meterText: document.getElementById("meterText"),
  meterFill: document.getElementById("meterFill"),
  activityLog: document.getElementById("activityLog"),
  sequenceBadge: document.getElementById("sequenceBadge"),
  bpmInput: document.getElementById("bpmInput"),
  bpmValue: document.getElementById("bpmValue"),
  masterMixSlider: document.getElementById("masterMixSlider"),
  masterMixValue: document.getElementById("masterMixValue"),
  masterHpfSlider: document.getElementById("masterHpfSlider"),
  masterHpfValue: document.getElementById("masterHpfValue"),
  masterLpfSlider: document.getElementById("masterLpfSlider"),
  masterLpfValue: document.getElementById("masterLpfValue"),
  recordButton: document.getElementById("recordButton"),
  playButton: document.getElementById("playButton"),
  clearLoopButton: document.getElementById("clearLoopButton"),
  stopAllButton: document.getElementById("stopAllButton"),
  ringToggleButton: document.getElementById("ringToggleButton"),
  sweetRingButton: document.getElementById("sweetRingButton"),
  ringState: document.getElementById("ringState"),
  combToggleButton: document.getElementById("combToggleButton"),
  combRandomButton: document.getElementById("combRandomButton"),
  combState: document.getElementById("combState"),
  chopperBurstButton: document.getElementById("chopperBurstButton"),
  chopperStormButton: document.getElementById("chopperStormButton"),
  chopperState: document.getElementById("chopperState"),
  subdivText: document.getElementById("subdivText"),
  pulseRateText: document.getElementById("pulseRateText"),
  driveSlider: document.getElementById("driveSlider"),
  driveValue: document.getElementById("driveValue"),
  echoDecaySlider: document.getElementById("echoDecaySlider"),
  echoDecayValue: document.getElementById("echoDecayValue"),
  echoAmpSlider: document.getElementById("echoAmpSlider"),
  echoAmpValue: document.getElementById("echoAmpValue"),
  ringMixSlider: document.getElementById("ringMixSlider"),
  ringMixValue: document.getElementById("ringMixValue"),
  ringFreqSlider: document.getElementById("ringFreqSlider"),
  ringFreqValue: document.getElementById("ringFreqValue"),
  combTimeSlider: document.getElementById("combTimeSlider"),
  combTimeValue: document.getElementById("combTimeValue"),
  combDecaySlider: document.getElementById("combDecaySlider"),
  combDecayValue: document.getElementById("combDecayValue"),
  chopperWindowSlider: document.getElementById("chopperWindowSlider"),
  chopperWindowValue: document.getElementById("chopperWindowValue"),
  chopperDensitySlider: document.getElementById("chopperDensitySlider"),
  chopperDensityValue: document.getElementById("chopperDensityValue"),
  rhythmButtons: Array.from(document.querySelectorAll(".rhythm-button"))
};

const appState = {
  audioContext: null,
  mediaStream: null,
  rig: null,
  meterBuffer: null,
  meterRaf: 0,
  sequenceToken: 0,
  isSequenceRunning: false,
  logEntries: []
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function choose(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function dbFromRms(rms) {
  return 20 * Math.log10(Math.max(rms, 1e-6));
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function logActivity(title, detail = "") {
  const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  appState.logEntries.unshift({ title, detail, timestamp });
  appState.logEntries = appState.logEntries.slice(0, 14);

  ui.activityLog.innerHTML = "";
  appState.logEntries.forEach((entry) => {
    const item = document.createElement("div");
    item.className = "activity-item";
    item.innerHTML = `<strong>${entry.timestamp} | ${entry.title}</strong>${entry.detail ? `<br>${entry.detail}` : ""}`;
    ui.activityLog.appendChild(item);
  });
}

class BrowserPerformanceRig {
  constructor(context) {
    this.context = context;
    this.sampleRate = context.sampleRate;

    this.processor = context.createScriptProcessor(1024, 1, 2);
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.outputGain = context.createGain();
    this.outputGain.gain.value = 0.92;

    this.processor.connect(this.analyser);
    this.analyser.connect(this.outputGain);
    this.outputGain.connect(context.destination);

    this.captureBuffer = new Float32Array(Math.floor(this.sampleRate * 10));
    this.loopBuffer = new Float32Array(Math.floor(this.sampleRate * 32));
    this.captureWriteIndex = 0;
    this.loopWriteIndex = 0;
    this.loopPlayIndex = 0;

    this.echoDelaySeconds = 0.3;
    this.echoAmp = 0.4;
    this.echoFeedback = 0.64;
    this.echoBuffer = new Float32Array(Math.floor(this.sampleRate * 0.6));
    this.echoWriteIndex = 0;

    this.combBufferL = new Float32Array(Math.floor(this.sampleRate * 1.2));
    this.combBufferR = new Float32Array(Math.floor(this.sampleRate * 1.2));
    this.combWriteIndex = 0;

    this.verbBufferL = new Float32Array(Math.floor(this.sampleRate * 0.12));
    this.verbBufferR = new Float32Array(Math.floor(this.sampleRate * 0.16));
    this.verbWriteL = 0;
    this.verbWriteR = 0;

    this.filterState = {};
    this.chopperVoices = [];
    this.pendingChopperVoices = 0;

    this.drive = 10;
    this.gateThreshold = 0.02;
    this.gateEnv = 0;
    this.ampFollower = 0;
    this.masterMix = 0.5;
    this.masterHpf = 140;
    this.masterLpf = 1500;
    this.bpm = 120;
    this.ringMix = 0.8;
    this.targetModFreq = 2;
    this.currentModFreq = 2;
    this.modPhase = 0;
    this.ringActive = false;
    this.ringEnv = 0;
    this.combDelayTime = 0.4;
    this.combDecay = 10;
    this.combActive = false;
    this.combEnv = 0;
    this.recording = false;
    this.playingLoop = false;
    this.loopEnv = 0;
    this.overdubAmp = 0.95;
    this.loopAmp = 0.8;
    this.rhythmSubdiv = 0;
    this.rhythmPhase = 0;
    this.rhythmEnv = 1;
    this.chopperWindow = 2;
    this.chopperDensity = 3;

    this.processor.onaudioprocess = (event) => this.process(event);
  }

  attachSource(sourceNode) {
    this.sourceNode = sourceNode;
    sourceNode.connect(this.processor);
  }

  setDrive(value) {
    this.drive = value;
  }

  setEchoDecay(value) {
    this.echoFeedback = clamp(0.35 + (value / 6) * 0.5, 0.2, 0.88);
  }

  setEchoAmp(value) {
    this.echoAmp = value;
  }

  setTempo(value) {
    this.bpm = value;
  }

  setMasterMix(value) {
    this.masterMix = value;
  }

  setMasterHpf(value) {
    this.masterHpf = value;
  }

  setMasterLpf(value) {
    this.masterLpf = value;
  }

  setRingMix(value) {
    this.ringMix = value;
  }

  setModFreq(value) {
    this.targetModFreq = value;
  }

  setRingActive(active) {
    this.ringActive = active;
  }

  setCombDelayTime(value) {
    this.combDelayTime = value;
  }

  setCombDecay(value) {
    this.combDecay = value;
  }

  setCombActive(active) {
    this.combActive = active;
  }

  setRecording(active) {
    if (active && !this.recording) {
      this.loopWriteIndex = 0;
    }
    this.recording = active;
  }

  setPlayingLoop(active) {
    if (active && !this.playingLoop) {
      this.loopPlayIndex = 0;
    }
    this.playingLoop = active;
  }

  clearLoop() {
    this.loopBuffer.fill(0);
    this.loopWriteIndex = 0;
    this.loopPlayIndex = 0;
  }

  stopAll() {
    this.setRecording(false);
    this.setPlayingLoop(false);
    this.setRingActive(false);
    this.setCombActive(false);
    this.setRhythmSubdiv(0);
    this.pendingChopperVoices = 0;
    this.chopperVoices = [];
  }

  setRhythmSubdiv(subdiv) {
    this.rhythmSubdiv = subdiv;
  }

  setChopperWindow(value) {
    this.chopperWindow = value;
  }

  setChopperDensity(value) {
    this.chopperDensity = value;
  }

  triggerChopperBurst(multiplier = 1) {
    this.pendingChopperVoices += Math.max(1, Math.round(this.chopperDensity * multiplier));
  }

  onePoleLowpass(input, cutoff, key) {
    const safeCutoff = clamp(cutoff, 20, this.sampleRate * 0.45);
    const alpha = 1 - Math.exp((-2 * Math.PI * safeCutoff) / this.sampleRate);
    const previous = this.filterState[key] || 0;
    const next = previous + alpha * (input - previous);
    this.filterState[key] = next;
    return next;
  }

  onePoleHighpass(input, cutoff, key) {
    const low = this.onePoleLowpass(input, cutoff, `${key}_lp`);
    return input - low;
  }

  updateEnvelope(current, active, attackSeconds, releaseSeconds) {
    const target = active ? 1 : 0;
    const time = active ? attackSeconds : releaseSeconds;
    const step = 1 / Math.max(1, time * this.sampleRate);
    return current + (target - current) * step;
  }

  writeCapture(sample) {
    this.captureBuffer[this.captureWriteIndex] = sample;
    this.captureWriteIndex = (this.captureWriteIndex + 1) % this.captureBuffer.length;
  }

  startChopperVoice() {
    const rates = [1, 0.5, 1.2, -1];
    const secondsBack = randomBetween(0.1, this.chopperWindow);
    const startIndex =
      (this.captureWriteIndex - Math.floor(secondsBack * this.sampleRate) + this.captureBuffer.length) %
      this.captureBuffer.length;

    this.chopperVoices.push({
      position: startIndex,
      step: choose(rates),
      remaining: Math.floor(randomBetween(0.08, 0.26) * this.sampleRate),
      total: 1,
      pan: randomBetween(-0.45, 0.45),
      amp: randomBetween(0.14, 0.24)
    });

    const voice = this.chopperVoices[this.chopperVoices.length - 1];
    voice.total = voice.remaining;
  }

  processChopper() {
    let left = 0;
    let right = 0;

    for (let index = this.chopperVoices.length - 1; index >= 0; index -= 1) {
      const voice = this.chopperVoices[index];
      const currentIndex = Math.floor(voice.position) % this.captureBuffer.length;
      const nextIndex = (currentIndex + 1) % this.captureBuffer.length;
      const fraction = voice.position - Math.floor(voice.position);
      const sample =
        this.captureBuffer[currentIndex] * (1 - fraction) + this.captureBuffer[nextIndex] * fraction;

      const progress = 1 - voice.remaining / Math.max(1, voice.total);
      const env = Math.sin(Math.PI * clamp(progress, 0, 1));
      const voiced = sample * voice.amp * env;
      left += voiced * (1 - voice.pan * 0.5);
      right += voiced * (1 + voice.pan * 0.5);

      voice.position = (voice.position + voice.step + this.captureBuffer.length) % this.captureBuffer.length;
      voice.remaining -= 1;

      if (voice.remaining <= 0) {
        this.chopperVoices.splice(index, 1);
      }
    }

    return [left, right];
  }

  process(event) {
    const input = event.inputBuffer.getChannelData(0);
    const outputL = event.outputBuffer.getChannelData(0);
    const outputR = event.outputBuffer.getChannelData(1);

    while (this.pendingChopperVoices > 0) {
      this.startChopperVoice();
      this.pendingChopperVoices -= 1;
    }

    for (let sampleIndex = 0; sampleIndex < input.length; sampleIndex += 1) {
      const raw = input[sampleIndex] || 0;

      this.ampFollower = Math.max(Math.abs(raw), this.ampFollower * 0.995);
      const gateTarget = this.ampFollower > this.gateThreshold;
      this.gateEnv = this.updateEnvelope(this.gateEnv, gateTarget, 0.05, 0.2);
      const gated = raw * this.gateEnv;

      const saturated = Math.tanh(gated * this.drive);

      const echoDelaySamples = Math.floor(this.echoDelaySeconds * this.sampleRate);
      const echoReadIndex =
        (this.echoWriteIndex - echoDelaySamples + this.echoBuffer.length) % this.echoBuffer.length;
      const echoed = this.echoBuffer[echoReadIndex];
      this.echoBuffer[this.echoWriteIndex] = saturated + echoed * this.echoFeedback;
      this.echoWriteIndex = (this.echoWriteIndex + 1) % this.echoBuffer.length;

      const processedMic = saturated + echoed * this.echoAmp;
      this.writeCapture(processedMic);

      if (this.recording) {
        const existing = this.loopBuffer[this.loopWriteIndex];
        this.loopBuffer[this.loopWriteIndex] = clamp(processedMic + existing * this.overdubAmp, -1, 1);
        this.loopWriteIndex = (this.loopWriteIndex + 1) % this.loopBuffer.length;
      }

      const ringInput = this.onePoleHighpass(processedMic, 100, "ring");
      this.currentModFreq += (this.targetModFreq - this.currentModFreq) * 0.00025;
      this.modPhase += (2 * Math.PI * this.currentModFreq) / this.sampleRate;
      if (this.modPhase > Math.PI * 2) {
        this.modPhase -= Math.PI * 2;
      }
      this.ringEnv = this.updateEnvelope(this.ringEnv, this.ringActive, 4, 4);
      const ringWet = ringInput * Math.sin(this.modPhase);
      const ringScene = ((1 - this.ringMix) * ringInput + this.ringMix * ringWet) * this.ringEnv;

      this.combEnv = this.updateEnvelope(this.combEnv, this.combActive, 10, 10);
      const combDelaySamples = Math.floor(this.combDelayTime * this.sampleRate);
      const combReadIndex =
        (this.combWriteIndex - combDelaySamples + this.combBufferL.length) % this.combBufferL.length;
      const combReadIndexR =
        (this.combWriteIndex - Math.floor(combDelaySamples * 1.08) + this.combBufferR.length) %
        this.combBufferR.length;
      const combTapL = this.combBufferL[combReadIndex];
      const combTapR = this.combBufferR[combReadIndexR];
      const combFeedback = clamp(0.4 + (this.combDecay / 16) * 0.52, 0.2, 0.92);
      this.combBufferL[this.combWriteIndex] = processedMic + combTapL * combFeedback;
      this.combBufferR[this.combWriteIndex] = processedMic + combTapR * combFeedback;
      this.combWriteIndex = (this.combWriteIndex + 1) % this.combBufferL.length;
      const combOutL = this.onePoleLowpass(combTapL, 1800, "comb_lp_l") * 0.6 * this.combEnv;
      const combOutR = this.onePoleLowpass(combTapR, 1800, "comb_lp_r") * 0.6 * this.combEnv;

      this.loopEnv = this.updateEnvelope(this.loopEnv, this.playingLoop, 0.08, 0.08);
      const loopSample = this.loopBuffer[Math.floor(this.loopPlayIndex)] || 0;
      if (this.playingLoop || this.loopEnv > 0.0001) {
        this.loopPlayIndex = (this.loopPlayIndex + 1) % this.loopBuffer.length;
      }
      const loopOut = loopSample * this.loopAmp * this.loopEnv;

      const [chopperL, chopperR] = this.processChopper();

      let wetL = ringScene + combOutL + loopOut + chopperL;
      let wetR = ringScene + combOutR + loopOut + chopperR;

      if (this.rhythmSubdiv > 0) {
        const pulseRate = (this.bpm / 60) * this.rhythmSubdiv;
        this.rhythmPhase += pulseRate / this.sampleRate;
        if (this.rhythmPhase >= 1) {
          this.rhythmPhase -= 1;
        }
        const pulse = this.rhythmPhase < 0.5 ? 1 : 0;
        this.rhythmEnv += (pulse - this.rhythmEnv) * 0.03;
        wetL *= this.rhythmEnv;
        wetR *= this.rhythmEnv;
      } else {
        this.rhythmEnv += (1 - this.rhythmEnv) * 0.03;
      }

      const verbTapL = this.verbBufferL[this.verbWriteL];
      const verbTapR = this.verbBufferR[this.verbWriteR];
      this.verbBufferL[this.verbWriteL] = wetL + verbTapR * 0.3;
      this.verbBufferR[this.verbWriteR] = wetR + verbTapL * 0.28;
      this.verbWriteL = (this.verbWriteL + 1) % this.verbBufferL.length;
      this.verbWriteR = (this.verbWriteR + 1) % this.verbBufferR.length;
      wetL += verbTapL * 0.32;
      wetR += verbTapR * 0.32;

      wetL = this.onePoleLowpass(this.onePoleHighpass(wetL, this.masterHpf, "master_hp_l"), this.masterLpf, "master_lp_l");
      wetR = this.onePoleLowpass(this.onePoleHighpass(wetR, this.masterHpf, "master_hp_r"), this.masterLpf, "master_lp_r");

      const dryL = processedMic;
      const dryR = processedMic;
      const finalL = dryL * (1 - this.masterMix) + wetL * this.masterMix;
      const finalR = dryR * (1 - this.masterMix) + wetR * this.masterMix;

      outputL[sampleIndex] = Math.tanh(finalL * 1.1);
      outputR[sampleIndex] = Math.tanh(finalR * 1.1);
    }
  }
}

function formatNumber(value, digits = 1) {
  return Number(value).toFixed(digits);
}

function pulseRateText(subdiv) {
  if (!subdiv) {
    return "0.00 Hz";
  }

  return `${formatNumber((Number(ui.bpmInput.value) / 60) * subdiv, 2)} Hz`;
}

function updateLabelText() {
  ui.bpmValue.textContent = `${ui.bpmInput.value} BPM`;
  ui.masterMixValue.textContent = `${ui.masterMixSlider.value}%`;
  ui.masterHpfValue.textContent = `${ui.masterHpfSlider.value} Hz`;
  ui.masterLpfValue.textContent = `${ui.masterLpfSlider.value} Hz`;
  ui.driveValue.textContent = formatNumber(ui.driveSlider.value, 1);
  ui.echoDecayValue.textContent = `${formatNumber(ui.echoDecaySlider.value, 1)} s`;
  ui.echoAmpValue.textContent = `${ui.echoAmpSlider.value}%`;
  ui.ringMixValue.textContent = `${ui.ringMixSlider.value}%`;
  ui.ringFreqValue.textContent = `${formatNumber(ui.ringFreqSlider.value, 1)} Hz`;
  ui.combTimeValue.textContent = `${formatNumber(ui.combTimeSlider.value, 2)} s`;
  ui.combDecayValue.textContent = `${formatNumber(ui.combDecaySlider.value, 1)} s`;
  ui.chopperWindowValue.textContent = `${formatNumber(ui.chopperWindowSlider.value, 1)} s`;
  ui.chopperDensityValue.textContent = `${ui.chopperDensitySlider.value} voices`;
}

function markPill(element, text, tone = "muted") {
  element.textContent = text;
  element.classList.remove("muted", "is-centered", "is-drifted");
  if (tone) {
    element.classList.add(tone);
  }
}

function updateRhythmButtons(activeSubdiv) {
  ui.rhythmButtons.forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.subdiv) === activeSubdiv);
  });
}

function updateRigUI() {
  const rig = appState.rig;
  const online = Boolean(rig);

  markPill(ui.engineBadge, online ? "Rig online" : "Rig offline", online ? "is-centered" : "muted");

  if (!rig) {
    markPill(ui.phaseBadge, "Phase idle", "muted");
    markPill(ui.loopBadge, "Looper stopped", "muted");
    markPill(ui.rhythmBadge, "Rhythm off", "muted");
    ui.phaseText.textContent = "Idle";
    ui.sequenceBadge.textContent = "Manual mode";
    ui.subdivText.textContent = "Off";
    ui.pulseRateText.textContent = "0.00 Hz";
    updateRhythmButtons(0);
    return;
  }

  markPill(ui.loopBadge, rig.recording ? "Recording loop" : rig.playingLoop ? "Loop playing" : "Looper stopped", rig.recording ? "is-drifted" : rig.playingLoop ? "is-centered" : "muted");
  markPill(ui.rhythmBadge, rig.rhythmSubdiv ? `Rhythm ${rig.rhythmSubdiv}` : "Rhythm off", rig.rhythmSubdiv ? "is-centered" : "muted");
  ui.recordButton.classList.toggle("is-active", rig.recording);
  ui.playButton.classList.toggle("is-active", rig.playingLoop);
  ui.ringToggleButton.classList.toggle("is-active", rig.ringActive);
  ui.combToggleButton.classList.toggle("is-active", rig.combActive);
  ui.ringState.textContent = rig.ringActive ? "Active" : "Idle";
  ui.combState.textContent = rig.combActive ? "Active" : "Idle";
  ui.subdivText.textContent = rig.rhythmSubdiv ? `${rig.rhythmSubdiv} subdivisions` : "Off";
  ui.pulseRateText.textContent = pulseRateText(rig.rhythmSubdiv);
  updateRhythmButtons(rig.rhythmSubdiv);
}

function setPhase(name, tone = "muted") {
  ui.phaseText.textContent = name;
  markPill(ui.phaseBadge, name, tone);
}

function syncRigFromControls() {
  if (!appState.rig) {
    return;
  }

  appState.rig.setTempo(Number(ui.bpmInput.value));
  appState.rig.setMasterMix(Number(ui.masterMixSlider.value) / 100);
  appState.rig.setMasterHpf(Number(ui.masterHpfSlider.value));
  appState.rig.setMasterLpf(Number(ui.masterLpfSlider.value));
  appState.rig.setDrive(Number(ui.driveSlider.value));
  appState.rig.setEchoDecay(Number(ui.echoDecaySlider.value));
  appState.rig.setEchoAmp(Number(ui.echoAmpSlider.value) / 100);
  appState.rig.setRingMix(Number(ui.ringMixSlider.value) / 100);
  appState.rig.setModFreq(Number(ui.ringFreqSlider.value));
  appState.rig.setCombDelayTime(Number(ui.combTimeSlider.value));
  appState.rig.setCombDecay(Number(ui.combDecaySlider.value));
  appState.rig.setChopperWindow(Number(ui.chopperWindowSlider.value));
  appState.rig.setChopperDensity(Number(ui.chopperDensitySlider.value));
  updateRigUI();
}

async function bootRig() {
  if (appState.rig) {
    await appState.audioContext.resume();
    logActivity("Audio resumed", "The browser rig is back online.");
    updateRigUI();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    markPill(ui.engineBadge, "Browser mic API missing", "is-drifted");
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
    const context = new AudioContextClass({ latencyHint: "interactive" });
    const source = context.createMediaStreamSource(stream);
    const rig = new BrowserPerformanceRig(context);
    rig.attachSource(source);

    appState.audioContext = context;
    appState.mediaStream = stream;
    appState.rig = rig;
    appState.meterBuffer = new Float32Array(rig.analyser.fftSize);

    syncRigFromControls();
    ui.bootButton.textContent = "Resume Audio Rig";
    logActivity("Rig booted", "Mic input, looper, and FX engine are ready.");
    startMeterLoop();
    updateRigUI();
  } catch (error) {
    console.error(error);
    markPill(ui.engineBadge, "Mic access denied", "is-drifted");
  }
}

function startMeterLoop() {
  if (appState.meterRaf) {
    window.cancelAnimationFrame(appState.meterRaf);
  }

  const tick = () => {
    if (appState.rig && appState.meterBuffer) {
      appState.rig.analyser.getFloatTimeDomainData(appState.meterBuffer);
      let sum = 0;
      for (let index = 0; index < appState.meterBuffer.length; index += 1) {
        const sample = appState.meterBuffer[index];
        sum += sample * sample;
      }
      const rms = Math.sqrt(sum / appState.meterBuffer.length);
      const db = dbFromRms(rms);
      const normalized = clamp((db + 60) / 60, 0, 1);
      ui.meterFill.style.width = `${Math.round(normalized * 100)}%`;
      ui.meterText.textContent = `${db.toFixed(1)} dB`;
    }

    appState.meterRaf = window.requestAnimationFrame(tick);
  };

  tick();
}

function ensureRig() {
  if (!appState.rig) {
    logActivity("Rig offline", "Boot the audio rig before triggering performance actions.");
    return false;
  }

  return true;
}

function setSequenceRunning(active) {
  appState.isSequenceRunning = active;
  ui.sequenceBadge.textContent = active ? "Sequence running" : "Manual mode";
  ui.sequenceButton.classList.toggle("is-active", active);
}

function stopSequence(resetPhase = true) {
  appState.sequenceToken += 1;
  setSequenceRunning(false);
  if (resetPhase) {
    setPhase("Phase idle", "muted");
  }
}

async function waitBeats(beats, token) {
  const ms = beats * (60000 / Number(ui.bpmInput.value));
  await sleep(ms);
  if (token !== appState.sequenceToken) {
    throw new Error("sequence-cancelled");
  }
}

async function runChopperPattern(iterations, token) {
  for (let count = 0; count < iterations; count += 1) {
    if (token !== appState.sequenceToken) {
      throw new Error("sequence-cancelled");
    }

    appState.rig.triggerChopperBurst(1);
    ui.chopperState.textContent = "Bursting";
    await sleep(randomBetween(90, 260));
  }
  ui.chopperState.textContent = "Ready";
}

async function runSequence() {
  if (!ensureRig()) {
    return;
  }

  stopSequence(false);
  appState.sequenceToken += 1;
  const token = appState.sequenceToken;
  setSequenceRunning(true);
  logActivity("Sequence started", "The phase runner is now steering the FX rig.");

  const phaseRing = async (name, hpf, lpf, modMin, modMax, beats) => {
    setPhase(name, "is-centered");
    logActivity(name, `Ring modulation from ${formatNumber(modMin, 1)} to ${formatNumber(modMax, 1)} Hz space.`);
    appState.rig.setMasterHpf(hpf);
    appState.rig.setMasterLpf(lpf);
    appState.rig.setRingActive(true);
    appState.rig.setModFreq(randomBetween(modMin, modMax));
    updateRigUI();
    await waitBeats(beats, token);
    appState.rig.setRingActive(false);
    updateRigUI();
  };

  const phaseComb = async (name, hpf, lpf, beats) => {
    setPhase(name, "is-centered");
    logActivity(name, "Comb wash opened with a fresh random delay time.");
    appState.rig.setMasterHpf(hpf);
    appState.rig.setMasterLpf(lpf);
    appState.rig.setCombDelayTime(randomBetween(0.3, 0.7));
    appState.rig.setCombActive(true);
    updateRigUI();
    await waitBeats(beats, token);
    appState.rig.setCombActive(false);
    updateRigUI();
  };

  const phaseChopper = async (name, iterations) => {
    setPhase(name, "is-centered");
    logActivity(name, "Pointer-relative chopper is pulling recent trumpet fragments.");
    await runChopperPattern(iterations, token);
  };

  try {
    while (token === appState.sequenceToken) {
      await phaseRing("Phase 1: Ring Mod", 800, 1500, 2, 3, 32);
      await phaseComb("Phase 2: Comb Delay + EQ", 60, 700, 32);
      await phaseChopper("Phase 3: Pointer Chopper", 30);
      await phaseRing("Phase 4: Bass Ring Mod", 200, 1000, 100, 200, 32);

      setPhase("Phase 4.5: Chill", "muted");
      logActivity("Phase 4.5: Chill", "Wet mix pulled back for a breath.");
      appState.rig.setMasterMix(0);
      updateRigUI();
      await waitBeats(24, token);

      setPhase("Phase 4.9: Returning To FX", "muted");
      appState.rig.setMasterMix(Number(ui.masterMixSlider.value) / 100);
      updateRigUI();

      await phaseComb("Phase 5: Comb Delay + EQ", 60, 700, 32);
      await phaseChopper("Phase 6: Pointer Chopper", 50);
      await phaseRing("Phase 7: Ring Mod", 300, 2500, 0.2, 0.9, 40);
      await phaseComb("Phase 8: Comb Delay + EQ", 60, 700, 32);
      await phaseChopper("Phase 9: Pointer Chopper", 30);
      await phaseRing("Phase 10: Sweet Ring Mod", 150, 1750, 800, 1000, 32);
      await phaseComb("Phase 11: Comb Delay + EQ", 60, 700, 32);
      await phaseChopper("Phase 12: Pointer Chopper", 30);

      appState.rig.setMasterHpf(140);
      appState.rig.setMasterLpf(1500);
      updateRigUI();
    }
  } catch (error) {
    if (error.message !== "sequence-cancelled") {
      console.error(error);
      logActivity("Sequence error", "The browser sequence hit an unexpected issue.");
    }
  } finally {
    if (token === appState.sequenceToken) {
      stopSequence();
      logActivity("Sequence stopped", "The rig is back in manual control.");
    }
  }
}

function toggleRecord() {
  if (!ensureRig()) {
    return;
  }
  appState.rig.setRecording(!appState.rig.recording);
  logActivity(appState.rig.recording ? "Loop recording armed" : "Loop recording stopped");
  updateRigUI();
}

function togglePlay() {
  if (!ensureRig()) {
    return;
  }
  appState.rig.setPlayingLoop(!appState.rig.playingLoop);
  logActivity(appState.rig.playingLoop ? "Loop playback engaged" : "Loop playback paused");
  updateRigUI();
}

function clearLoop() {
  if (!ensureRig()) {
    return;
  }
  appState.rig.clearLoop();
  logActivity("Loop cleared", "The overdub buffer has been zeroed.");
  updateRigUI();
}

function stopAll() {
  if (!ensureRig()) {
    return;
  }
  stopSequence(false);
  appState.rig.stopAll();
  logActivity("Stop all", "Recording, playback, rhythm, and active FX were reset.");
  updateRigUI();
}

function toggleRing() {
  if (!ensureRig()) {
    return;
  }
  appState.rig.setRingActive(!appState.rig.ringActive);
  logActivity(appState.rig.ringActive ? "Ring mod active" : "Ring mod idle");
  updateRigUI();
}

function sweetRingBurst() {
  if (!ensureRig()) {
    return;
  }
  appState.rig.setRingActive(true);
  appState.rig.setModFreq(randomBetween(800, 1000));
  ui.ringFreqSlider.value = formatNumber(appState.rig.targetModFreq, 1);
  updateLabelText();
  logActivity("Sweet ring burst", "High carrier ring modulation engaged.");
  updateRigUI();
}

function toggleComb() {
  if (!ensureRig()) {
    return;
  }
  appState.rig.setCombActive(!appState.rig.combActive);
  logActivity(appState.rig.combActive ? "Comb wash active" : "Comb wash idle");
  updateRigUI();
}

function randomizeComb() {
  if (!ensureRig()) {
    return;
  }
  const next = randomBetween(0.3, 0.7);
  ui.combTimeSlider.value = formatNumber(next, 2);
  appState.rig.setCombDelayTime(next);
  updateLabelText();
  logActivity("Comb randomized", `New comb delay time: ${formatNumber(next, 2)} seconds.`);
}

function triggerBurst(multiplier) {
  if (!ensureRig()) {
    return;
  }
  appState.rig.triggerChopperBurst(multiplier);
  ui.chopperState.textContent = multiplier > 1 ? "Storming" : "Bursting";
  logActivity(multiplier > 1 ? "Chopper storm" : "Chopper burst", "Recent trumpet audio is being re-thrown into the mix.");
  updateRigUI();
  window.setTimeout(() => {
    ui.chopperState.textContent = "Ready";
  }, 500);
}

function setRhythm(subdiv) {
  if (!ensureRig()) {
    return;
  }

  const target = appState.rig.rhythmSubdiv === subdiv ? 0 : subdiv;
  appState.rig.setRhythmSubdiv(target);
  logActivity(target ? "Rhythm active" : "Rhythm off", target ? `Subdivision ${target} is chopping the wet bus.` : "Pulse gating has been cleared.");
  updateRigUI();
}

function bindControls() {
  ui.bootButton.addEventListener("click", bootRig);
  ui.sequenceButton.addEventListener("click", runSequence);
  ui.stopSequenceButton.addEventListener("click", () => {
    stopSequence();
    logActivity("Sequence stopped", "The rig is back in manual control.");
  });
  ui.recordButton.addEventListener("click", toggleRecord);
  ui.playButton.addEventListener("click", togglePlay);
  ui.clearLoopButton.addEventListener("click", clearLoop);
  ui.stopAllButton.addEventListener("click", stopAll);
  ui.ringToggleButton.addEventListener("click", toggleRing);
  ui.sweetRingButton.addEventListener("click", sweetRingBurst);
  ui.combToggleButton.addEventListener("click", toggleComb);
  ui.combRandomButton.addEventListener("click", randomizeComb);
  ui.chopperBurstButton.addEventListener("click", () => triggerBurst(1));
  ui.chopperStormButton.addEventListener("click", () => triggerBurst(3));

  [
    ui.bpmInput,
    ui.masterMixSlider,
    ui.masterHpfSlider,
    ui.masterLpfSlider,
    ui.driveSlider,
    ui.echoDecaySlider,
    ui.echoAmpSlider,
    ui.ringMixSlider,
    ui.ringFreqSlider,
    ui.combTimeSlider,
    ui.combDecaySlider,
    ui.chopperWindowSlider,
    ui.chopperDensitySlider
  ].forEach((control) => {
    control.addEventListener("input", () => {
      updateLabelText();
      syncRigFromControls();
    });
  });

  ui.rhythmButtons.forEach((button) => {
    button.addEventListener("click", () => setRhythm(Number(button.dataset.subdiv)));
  });

  window.addEventListener("keydown", (event) => {
    if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
      return;
    }

    switch (event.key) {
      case "1":
        toggleRecord();
        break;
      case "2":
        togglePlay();
        break;
      case "3":
        clearLoop();
        break;
      case "4":
        stopAll();
        break;
      case "7":
        setRhythm(2);
        break;
      case "8":
        setRhythm(3);
        break;
      case "9":
        setRhythm(4);
        break;
      default:
        break;
    }
  });
}

updateLabelText();
bindControls();
updateRigUI();
logActivity("Ready", "Boot the rig to start the browser version of your SuperCollider performance patch.");
