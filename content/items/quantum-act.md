---
title: Quantum Adaptive Chirplet Transform
headline: Chirplets on a Quantum Computer
section: research
org: MannLab
role: Lead researcher
dates: Sep 2026 – Present
status: in-progress
place: toronto
tags: [quantum, qiskit, signal-processing, eeg, research, python]
audience: { recruiter: 2, research: 3, dev: 2 }
blurb: >-
  I'm building a quantum version of the Adaptive Chirplet Transform, a method Steve Mann co-invented for breaking signals like EEG into short "chirps."
  A chirp's phase is quadratic, so it maps exactly onto a small set of phase and controlled-phase gates. One quantum Fourier transform then covers the whole frequency axis at once.
  I'm testing it on public EEG datasets, from seizure recordings to mental-arithmetic sessions, and results will go up once the work is further along.
stack: [Python, Qiskit 2 (Aer, QSVC / VQC), IBM Heron noise model, PyTorch, scikit-learn]
datasets: [CHB-MIT, Siena Scalp EEG, PhysioNet EEGMAT]
outcomes: []   # results withheld until Khalil says the project is ready (2026-09-23)
links: []      # repo is private
media: []
draft: false
---
## How it works
A chirplet is a short wave whose frequency sweeps over time, and its phase is quadratic in time. With the time index encoded in n qubits, that quadratic phase maps *exactly* onto n single-qubit phase gates plus n(n−1)/2 controlled-phase gates. There's no approximation. A single quantum Fourier transform then gives the whole frequency axis at once, which is the expensive part of the classical transform's search.

## What I'm testing
- Chirplet features for cross-patient seizure detection (CHB-MIT, Siena) and for mental-arithmetic EEG (PhysioNet EEGMAT).
- Quantum classifiers (QSVC, VQC) and a small quantum reservoir against classical baselines.
- What the circuits cost on real hardware, using IBM's Heron noise model.
