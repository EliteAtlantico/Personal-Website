---
title: Computer-Vision Piano Coach
headline: A Webcam That Corrects Your Wrists
section: research
org: MannLab
role: Built the piano side end to end (software, experiments, analysis)
dates: 2026
place: toronto
tags: [computer-vision, eeg, bci, python, mediapipe, research]
audience: { recruiter: 2, research: 3, dev: 2 }
blurb: >-
  At MannLab I built, from start to finish, a computer-vision coach that watches your hands at the piano and scores your technique live: hand arch, wrist movement, centering, and finger independence.
  I ran the pilot EEG experiments myself, comparing practice with and without the coach.
  With coaching on, brain activity trended toward the beta and gamma bands linked to focused attention.
stack: [Python, MediaPipe, OpenCV, Muse EEG headband (4-channel), MNE-Python]
outcomes:
  - "Live 0–100 technique score and gentle on-screen corrections from an ordinary webcam"
  - "Designed and ran the piano arm of a pilot EEG study (coached vs. uncoached practice)"
links:
  - { label: "GitHub", url: "https://github.com/EliteAtlantico/PianoCV_FormRating" }
media: []   # candidate: the "Piano Scoring UI" screenshot (no people in it)
draft: false
---
## How it works
- **Tracking.** A webcam feeds MediaPipe hand and pose landmarks through OpenCV. A digital keyboard is drawn on screen, and the hands are mapped onto it to detect hand shape and key presses.
- **Scoring.** Each frame is scored on four things piano teachers nag about:
  - Hand arch (the "C-shape").
  - Wrist flexibility (vertical wrist motion).
  - Wrist centering over the chord.
  - Finger independence.
- **Feedback.** A continuous overlay shows a 0–100 score and short prompts like "straighten wrist". The prompts are rate-limited and smoothed so they coach without nagging and never interrupt playing.

## The study
I ran the piano experiments. Participants practised short trials with the coach on and off while wearing a 4-channel Muse EEG headband (TP9, AF7, AF8, TP10 at 256 Hz). The EEG was cleaned in MNE-Python (60 Hz notch, 1–50 Hz bandpass, artifact rejection) and lined up with the practice sessions afterwards by timestamp. With coaching on, relative power shifted toward beta and gamma. The pilot was small, so this is a consistent trend, not a significant result. Teammates built and ran a guitar version alongside it.
