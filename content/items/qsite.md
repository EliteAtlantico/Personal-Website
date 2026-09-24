---
title: Qubit Routing for Q-SITE 2026
headline: Beating SABRE at Its Own Game
section: projects
org: Q-SITE 2026 Quantum Hackathon (team entry)
role: "Built the router's learned side: GNN, policy net, and a self-generated training dataset"
dates: Sep 2026 – Present
status: in-progress
place: toronto
tags: [quantum, qiskit, gnn, graph-transformer, search, python, hackathon]
audience: { recruiter: 2, research: 3, dev: 3 }
blurb: >-
  For my team's Q-SITE 2026 entry, I built a qubit router, which decides where each qubit sits on the chip and where to insert SWAPs so a circuit can actually run.
  I implemented a graph neural network and a policy net to prune the router's search, and trained them on a dataset I designed and generated myself.
  It currently beats Qiskit's SABRE on valid submissions (67.0 vs. 76.0) and is provably optimal on four of the six benchmarks.
stack: [Python, PyTorch, Qiskit 2.5, NetworkX, OR-Tools CP-SAT, graph transformer, beam search, DAgger, distillation]
outcomes:
  - "Total score 67.0 vs. 283.5 for the organizers' baseline (−76.4%)"
  - "Beats Qiskit SABRE's best valid total (76.0) while obeying the challenge's strict program-order rule"
  - "4 of 6 benchmarks proven optimal"
links:
  - { label: "GitHub", url: "https://github.com/arhamaamir1406/quantumania-submission" }
media: []
draft: false
---
TODO: deep-dive once the competition wraps.
