---
title: Tech-Head
section: hobbies
tags: [hobby, linux, android, homelab, local-ai]
audience: { recruiter: 1, research: 0, dev: 3 }
blurb: >-
  I run Arch Linux (btw) with Hyprland on my desktop, and it's also my home server: Tailscale connects my devices to it, llama.cpp serves local models, and all my DNS goes through AdGuard Home.
  Maintaining it has taught me a lot, and Hermes Agent has become my go-to harness for local AI.
  My phone gets the same tinkering, down to an app that makes me solve mental math before it lets me open Instagram.
stack: [Arch Linux, Hyprland, Waybar, Ghostty, Starship, JetBrains Mono, Tailscale, llama.cpp, Hermes Agent, AdGuard Home, Shizuku, Curbox]
draft: false
---

## The desktop
Arch Linux on Hyprland (83 keybinds and counting), with Waybar, Ghostty, Starship and JetBrains Mono. I'm always tweaking it, partly for productivity and partly because it looks cooler.

## The home server
The same machine stays on around the clock. Keeping it running is how I learned to maintain a server:

- **Tailscale** connects all my devices to it, wherever I am.
- **Local AI.** It runs local LLMs with llama.cpp, vLLM and SGLang, and Hermes Agent is my go-to harness for local AI.
- **AdGuard Home.** All my DNS is routed through it, so ads and trackers are blocked before they load.

## The phone
Stock Android wasn't mine enough, so I went further than a launcher. I cross-compiled static ARM64 builds of curl and wget with the Android NDK, and wrote a tiny rootless package installer (jq, fd, ripgrep, bat…) that runs through a patched Shizuku shell. One of my apps, Curbox, makes me solve mental math before it lets me open Instagram.
