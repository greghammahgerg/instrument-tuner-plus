# Brass Drift

Brass Drift is a dependency-free browser practice app for trumpet players. It listens to your mic, detects stable notes, automatically shifts a drone to follow those notes, and shows a visual tuner against the active center.

The project also includes `fx-lab.html`, a separate browser performance page modeled after the provided SuperCollider trumpet rig with live FX, looping, rhythm chopping, and a phase sequencer.

## Features

- Live pitch detection in the browser
- Automatic note locking after a stable hold
- Smooth drone retargeting based on the locked note
- Visual tuner with cents offset
- Per-note intonation history graphs
- Concert pitch or Bb trumpet note display
- Adjustable hold time, glide time, interval, and drone level

## Run it

Because the browser microphone APIs require a secure context, serve the folder over `http://localhost` or `https`.

If Python is available:

```bash
cd trumpet-practice-app
python -m http.server 4173
```

Then open:

```text
http://localhost:4173
```

Pages:

- `http://localhost:4173/` for the tuner + auto-follow drone page
- `http://localhost:4173/fx-lab.html` for the live FX lab

## Notes

- Headphones are strongly recommended so the mic does not feedback.
- The app is tuned for monophonic brass input and works best with steady long tones.
- The current prototype locks to the nearest equal-tempered note once your pitch is stable.
