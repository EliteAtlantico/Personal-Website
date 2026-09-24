---
title: KC-Bots
headline: Robots That Snap Together
section: projects
org: Self-initiated
role: Team Lead
dates: Summer 2025 – paused
status: paused
place: kuwait
tags: [embedded, esp32, pcb, kicad, firmware, robotics, c++, esp-now]
audience: { recruiter: 3, research: 2, dev: 3 }
blurb: >-
  My first real build, and still my favourite: spherical ESP32 robots meant to find each other and magnetically snap together into whatever shape you give them as a 3D model.
  I designed a custom KiCad board (ESP32, BNO055 IMU, motor drivers, LiPo charging, electromagnet) and wrote the firmware, an ESP-NOW mesh network, and a simulator that turns an STL into a build plan for the swarm.
  It's paused while I'm at school, with the drive system and through-shell magnetic docking still to build.
stack: [ESP32, C++, PlatformIO, ESP-NOW, KiCad, BNO055 IMU, Hall sensors, Fusion 360, 3D printing]
outcomes:
  - "Custom PCB designed and fabricated (Gerbers July 2025); IMU, motors and electromagnet verified working"
  - "ESP-NOW mesh with 10 Hz heartbeats and relay handoff"
  - "Host tools: STL → voxel converter, web visualizer, swarm simulator"
links: []   # KC-Bots repo is private
media: []
draft: false
---
## The idea
Give the swarm a 3D model and it rebuilds that shape out of robots. Each robot is a sphere with 8 docking ports arranged like a body-centred cubic lattice. A rotating inner unit aims an electromagnet at whichever port needs to latch.

## What works
- **Board.** A custom KiCad PCB with an ESP32, BNO055 IMU, two motor drivers and flywheel motors, LiPo charging, and a MOSFET-switched electromagnet. It was fabricated in July 2025, and the IMU, motors and magnet all worked.
- **Sensing.** 8 Hall sensors detect neighbouring magnets for orientation and docking.
- **Networking.** An ESP-NOW mesh with 10 Hz heartbeats and a relay handoff protocol, so messages hop across the swarm.
- **Planning.** An STL → voxel converter, a web visualizer, and a swarm simulator to plan builds before touching hardware.

## What's left
The drive system, and making the magnet hold reliably through the casing wall. Both are designed but not built yet.
