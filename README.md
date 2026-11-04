# Lift Log

A small offline web app (PWA) for the 4-day upper/lower muscle growth plan. Built for the iPhone 18 Pro (402 × 874 pt).

**Live:** https://baspa.github.io/lift-log/

- Pick the training day (Day 1–4). The app suggests the next one in the rotation.
- Can't make it? **Skip this day** moves the rotation on to the next day. Skips show in History and can be undone.
- Exercises are listed in order with sets, rep range and rest time.
- Log kg and reps per set. Tap ✓ with an empty field to copy last session's value.
- The rest timer starts on ✓. It beeps at the minimum rest and again at the maximum. Supersets skip the rest between A1 and A2.
- "Add a little weight" appears when you hit the top of the rep range on every set last time.

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
