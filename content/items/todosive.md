---
title: Todosive
headline: Yes, I Built a To-Do App
section: projects
org: Personal project
role: Sole developer
dates: 2026
place: toronto
tags: [typescript, svelte, electron, sqlite, fullstack]
audience: { recruiter: 2, research: 0, dev: 3 }
blurb: >-
  Yes, I know: everyone builds a to-do app.
  My heavily customized Notion setup was eating upwards of 2 GB of RAM, so I built Todosive, which runs in about 300 MB and has exactly the features I want.
  It's an offline-first Svelte 5 app with a Fastify and SQLite backend, an Electron tray client, and Google Calendar sync, plus habits, a journal, RPG-style stats and a tiny dungeon mini-game.
stack: [TypeScript, Svelte 5, Vite, Dexie (IndexedDB), Fastify 5, SQLite (node:sqlite), Electron, Docker, Google Calendar API, Vitest]
outcomes:
  - "~300 MB of RAM vs. 2 GB+ for my old Notion setup"
  - "~19.5k lines of TypeScript, ~200 tests"
links: []   # repo is private
media: []
draft: false
---
## What's in it
- **Life-area tabs**, tasks, and habits with streaks.
- **An RPG layer.** XP, six stats and skills, plus an optional hardcore mode that drains HP when you slack.
- **Works offline everywhere**, syncing across devices, with a push to Google Calendar.
- **A PIN-locked journal.** The PIN is stored only as a PBKDF2-SHA-256 hash.
- **On the desktop:** a tray counter, a global quick-add hotkey (bound in Hyprland), and launch at login.
- **A clicker game and a dungeon with a boss arena**, because a to-do app should be at least a little fun.
