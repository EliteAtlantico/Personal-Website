---
title: Shape from Lighting
headline: Seeing White on White
section: projects
org: Solo project
role: Sole developer & author
dates: Summer 2026
place: toronto
tags: [computer-vision, deep-learning, u-net, pytorch, blender, research]
audience: { recruiter: 3, research: 3, dev: 3 }
blurb: >-
  While building a VR snow game, I learned that normal computer vision just can't find a snowball sitting on snow.
  So I built a U-Net that ignores colour and recovers an object's 3D surface shape from how light falls on it.
  On shapes it never saw in training, it cut error 43% versus classical photometric stereo, and by two-thirds from a single photo.
stack: [Python, PyTorch, U-Net (1.95M params), Blender (headless synthetic data)]
outcomes:
  - "43% lower normal error than classical photometric stereo with 4 lights (8.04° vs 14.02°)"
  - "Works from a single photo: 19.63° vs 60.02°"
  - "Halves error in shadowed regions (9.89° vs 19.86°)"
  - "Built a 1,000-scene synthetic dataset, split by shape so test objects are never seen in training"
links: []
media: []
draft: false
---
## The problem
Colour- and texture-based vision falls apart when an object is the same colour as what it's sitting on. A snowball on snow or a white part on a white tray has almost no visible edge. Shading still gives it away, though. How bright a matte surface looks depends on which way it faces, not what colour it is.

## What I built
- **Data.** No public dataset fit, so I wrote a headless Blender pipeline. It renders a matte object on a nearly identical tray (0.85 vs 0.80 brightness) under four known lights plus a held-out fifth.
  - 1,000 scenes: 25 shapes × 40 orientations, saved as 16-bit PNGs with exact normals and masks.
  - The split is by shape, so the validation and test objects never appear in training.
  - A separate 36-scene holdout (torus knot, helix, bumpy cube) was rendered with a different seed and looked at only once, after all tuning.
- **Model.** A 4-scale U-Net (32→256 channels, 1.95M parameters).
  - A shared encoder reads each photo together with its light direction. Features are max-pooled across photos, so it accepts any number of photos in any order. Training shows it a random 1–4 photos per example.
  - It predicts per-pixel surface normals and albedo. A fixed physics layer, Î = ρ·max(0, L·N̂), re-renders the photos, and that reconstruction error is part of the loss.
- **Training.** AdamW for 150 epochs across 3 seeds, which ended within 0.14° of each other. Augmentation uses 8 square symmetries × photo-order shuffling, giving 192 valid views per example.

## Results
Mean angular error on unseen test shapes (lower is better):

| Photos | U-Net | Classical photometric stereo |
|---|---|---|
| 1 | **19.63°** | 60.02° |
| 2 | **12.14°** | 39.36° |
| 3 | **9.49°** | 16.29° |
| 4 | **8.04°** | 14.02° |

- In fully lit pixels, both methods are about even (6.27° vs 6.47°).
- The learned prior pays off in shadow: 9.89° vs 19.86°.
- At 16-bit, it held around 8.2° even with the shading dimmed 200×. At 8-bit it collapsed to 21.68°, which is a good argument for keeping raw sensor bit depth.

## What didn't work
- **Cast shadows** (one part of an object shading another) aren't modelled, so error climbs on self-occluding shapes like the torus knot.
- With very oblique lighting outside the training range, the classical method actually wins (4.43° vs 6.94°).
- It's trained on 25 idealised synthetic shapes. That's a narrow world, and it can be confidently wrong on shiny or textured real surfaces.
