---
title: Butler[bot]
headline: A Robot That Does Your Chores (in Simulation, For Now)
section: projects
org: Battle of the Schools hackathon (U of T vs. Waterloo)
role: LLM agent (tool calls + reasoning), initial balancing and driving, Whisper voice input
team: [Arham Aamir, Khalil Chaghouri, Dev Arun, Tianjun Xu]
dates: Sep 2026
place: toronto
tags: [robotics, llm, agents, mujoco, python, hackathon]
audience: { recruiter: 3, research: 2, dev: 3 }
blurb: >-
  At the Battle of the Schools hackathon (U of T vs. Waterloo), our team of four built Butler[bot], a home robot you can ask to do chores in plain English.
  I built its brain, a local LLM that plans each job by calling tools and reasoning over the results. I also got the robot balancing and driving in MuJoCo and added Whisper voice input.
  As a team, we hit 83 of 84 picks and 28 of 30 full chores in testing.
stack: [Python, MuJoCo, Qwen3.8-27B via llama-server (tool calling), Whisper, YOLO-World, A* + occupancy mapping, LQR balance control, GitHub Actions CI]
outcomes:
  - "Team result: 28/30 full chores (put in basket, hand to a person, tidy the table)"
  - "Team result: 83/84 picks from random positions and rotations"
links:
  - { label: "GitHub", url: "https://github.com/EliteAtlantico/Butler-Bot-" }
  - { label: "Devpost", url: "https://devpost.com/software/butler-bot" }
media: []
draft: false
---
## What it does
"Bring me the water bottle from the kitchen." Butler[bot] works out what you asked for, searches the house, drives over, picks the bottle up, and brings it back. You can take over from your phone at any point.

## My part
- **The agent.** A local LLM runs a tool-calling loop: look around, go near, inspect, plan a grasp, pick up, put down. It reads each result before choosing the next step, so there's no fixed list of chores. It won't repeat a call that has already failed twice, and every tool reports *why* it failed so the model can try something else.
- **Balance and driving.** I got the two-wheeled, self-balancing BracketBot standing and moving around in the MuJoCo simulation. Everything else was built on top of that base.
- **Voice.** Local Whisper speech-to-text, so you can say what you want in the phone app.

## The rest of the robot
My teammates built the open-vocabulary perception (YOLO-World), occupancy mapping and A* navigation, grasp planning and arm articulation, and the phone remote.
