# Lift Log

A small offline web app (PWA) for the 4-day upper/lower muscle growth plan. Built for the iPhone 18 Pro (402 × 874 pt).

**Live:** https://baspa.github.io/lift-log/

- Pick the training day (Day 1–4). The app suggests the next one in the rotation.
- Exercises are listed in order with sets, rep range and rest time.
- Log kg and reps per set.
- The rest timer starts on ✓. It beeps at the minimum rest and again at the maximum. Supersets skip the rest between A1 and A2.
- Each exercise shows a target based on your history (double progression): one more rep per set at the same weight until every set hits the top of the range, then one weight step up (2 kg dumbbells, 2.5 kg stacks/barbell, 5 kg leg press/squat) and back to the bottom of the range. Below the range two sessions in a row drops the weight about 10%. Targets show as the grey placeholders; ✓ with an empty field logs the target.

## Install on iPhone

Open the link in Safari → Share → **Add to Home Screen**. It then runs full screen and works offline.

## Data

Everything is stored in the browser's `localStorage` on the phone. Use **History → Export** for a JSON backup and **Import** to restore it.

## Development

Plain HTML, CSS and ES modules; no build step.

```sh
python3 -m http.server 8000
```

The program lives in `js/program.js`. Bump `CACHE` in `sw.js` on every deploy so installed apps pick up the new files.
