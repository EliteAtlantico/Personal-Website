---
title: Brain Freeze
headline: Brain Freeze
section: research
org: MannLab / Mersivity
role: Third of five authors · wrote the paper · helped debug the Unity app
dates: 2026
place: toronto
publication:
  venue: IEEE GEM 2026 (Berlin)
  title: "Cocaine Buzzkill: An XR Game To Take Aim Against the Drug Epidemic"
  position: 3 of 5
  status: published
tags: [xr, vr, eeg, bci, unity, research, published]
audience: { recruiter: 3, research: 3, dev: 2 }
blurb: >-
  I wrote the IEEE GEM 2026 paper on a mixed-reality snowball game you play outside right after lying in the snow, and helped debug the Unity app behind it.
  A Muse EEG headband tracks how alert you are, and the colder and sharper you get, the harder your snowballs hit.
  The idea is to turn the natural dopamine rush of cold exposure into something fun and social: a drug-free alternative for people in addiction recovery.
stack: [Unity, Meta Quest 3, Muse S EEG, Android (MuseLog), OSC/UDP, ESP32]
outcomes:
  - "Published at IEEE GEM 2026 in Berlin (third of five authors)"
  - "Wrote the paper"
  - "Played indoors and outdoors in real snow, and stable in both"
links: []
media: []   # candidates: snow-angel photo (Fig 1), architecture diagram (Fig 5, redraw as SVG), ESP32 haptic headband (Fig 7)
draft: false
---
## Why snow?
Cold exposure spikes dopamine by roughly 250%, about the same as cocaine. It also raises norepinephrine more (~530% vs ~400%), and the effect lasts up to three hours with no crash (figures from the literature). The lab's winter swim community already sees what that does for people, and many members are in recovery. The game tries to make that state something you *want* to chase.

## How it plays
Players warm up with a jog, make snow angels, then throw snowballs in mixed reality through Quest 3 passthrough. Waves escalate from virtual targets to enemies, played with controllers or bare hands.
- **Arousal feeds damage.** A custom Android app, MuseLog, streams the Muse headband's EEG band powers to the headset over OSC/UDP. The game computes a smoothed β/α arousal score from them, which scales your damage from 1.0× up to 3.0× and snowball size up to 2.0×.
- **A "collective high" add-on.** An ESP32 and a haptic motor mounted on a Muse headband buzz every other player's head when one player hits peak arousal, with under 100 ms of latency.
- **Throw detection.** Snowballs are tracked with headset cameras, an ESP32 camera pod, and an HB100 radar behind the physical target.

## What went wrong
- Picking out white snowballs against white snow with standard computer vision was close to impossible. That problem is what sent me off to build [Shape from Lighting](/projects/shape-from-lighting).
- Shivering adds muscle noise in the same EEG band, which can fake an arousal spike. Smoothing only partly fixes it.
- The headset and headband aren't waterproof, which is a real constraint for a game played in snow.
