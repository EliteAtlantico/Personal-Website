---
title: AI Scam Detector for Older Adults
headline: One Hotkey Between Grandma and a Scammer
section: research
org: AP Research Capstone (American School of Kuwait)
role: Sole researcher & developer
dates: Sep 2024 – May 2025
place: kuwait
paper: "AI's Potential to Defend the Elderly from Socially Engineered Cybersecurity Threats"
tags: [ai, python, computer-vision, security, research]
audience: { recruiter: 2, research: 3, dev: 2 }
blurb: >-
  In my last year of high school (2024–25), I built a tool that lets older adults press one hotkey to check what's on their screen for scams: Google Cloud Vision reads it and ChatGPT explains the warning in plain language.
  Across phishing emails, fake websites and scam-call transcripts, it scored an F1 of 89%, and it caught every email, text and download scam in the test set.
  I wrote and defended a 4,000-word AP Research paper on it.
stack: [Python, OpenAI API (GPT-4o mini), Google Cloud Vision]
outcomes:
  - "F1 score of 89.36% on a small hand-built test set (95% CI 70–96.7%)"
  - "100% on emails, texts and downloads"
  - "Plain-language warnings in seconds from a single hotkey (Ctrl + Shift + S)"
  - "4,000-word AP Research paper, written and defended"
links: []
media: []
draft: false
---
## Why
Older adults are the group scammers target most, and the scams keep getting better. Voice-cloned "family emergency" calls are one example. I wanted something simple enough that a grandparent would actually use it: one hotkey, no jargon, and a clear explanation of *why* something looks wrong.

## How it works
Press **Ctrl + Shift + S**. The tool screenshots what's in front of you, Google Cloud Vision extracts the text and content, and ChatGPT decides whether it looks like social engineering. It then explains the red flags in short, jargon-free language. Before I built anything, I turned 20 sources on usability research and AI detection into a rubric: ease of use, learnability, error handling, accuracy, speed and adaptability. The tool was designed and graded against it.

## Results
- **Overall F1: 89.36%.** The test set was small, so the 95% confidence interval runs from 70% to 96.7%.
- **Perfect on emails, texts and downloads**, the most common scam channel.
- **Weakest on phone-call transcripts.** The line between spam and scam is blurry there.
- **Too cautious.** It only fully cleared 4 of 9 genuine items and hedged on the other 5.
- **Speed.** 2–8 seconds for the model, plus a few seconds for image recognition.

## What I'd do next
A bigger dataset, a more polished interface, and live usability studies with older adults. That's the real test of whether they'd trust it.
