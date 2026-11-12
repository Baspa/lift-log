# Lift Log

A small offline web app (PWA) for the 4-day upper/lower muscle growth plan. Built for the iPhone 18 Pro (402 × 874 pt).

**Live:** https://baspa.github.io/lift-log/

- Pick the training day (Day 1–4). The app suggests the next one in the rotation.
- Can't make it? **Skip this day** moves the rotation on to the next day. Skips show in History and can be undone.
- Exercises are listed in order with sets, rep range and rest time.
- Log kg and reps per set.
- The rest timer starts on ✓. It beeps at the minimum rest and again at the maximum. Supersets skip the rest between A1 and A2.
- Each exercise shows a target based on your history (double progression): one more rep per set at the same weight until every set hits the top of the range, then one weight step up (2 kg dumbbells, 2.5 kg stacks/barbell, 5–7 kg leg curl/extension, 5–11 kg leg press; a weight you logged before within that range wins) and back to the bottom of the range. Below the range two sessions in a row at the same weight drops it about 10%. Targets show as the grey placeholders; ✓ with an empty field logs the target.

## Install on iPhone

Open the link in Safari → Share → **Add to Home Screen**. It then runs full screen and works offline.

## Data

Everything is stored in the browser's `localStorage` on the phone. Use **History → Export** for a JSON backup and **Import** to restore it.

### Backup to GitHub

The app can back up your log to a private GitHub repo by itself. It does this after every workout, two minutes after a change, and when you open or leave the app. Each backup replaces `history.json` in the repo, and the commit history keeps every older version. If you're offline, it waits and tries again later.

1. Open https://github.com/settings/personal-access-tokens/new.
2. Name the token "Lift Log" and pick a long expiry. The default is 30 days, and backups stop when it runs out.
3. Under **Repository access**, choose **Only select repositories** → `Baspa/lift-log-data`.
4. Under **Repository permissions**, set **Contents** to **Read and write**.
5. Generate the token, then paste it in Lift Log under **History → Backup** and tap **Connect**.

The token is stored only on the phone and can only reach that one repo. When it expires or stops working, the Backup card says so: tap **Stop backing up**, make a new token, and connect again.

On a new phone, connect with a token the same way. The app offers to restore the workouts from GitHub; if a workout exists in both places, the newer copy wins.

## Development

Plain HTML, CSS and ES modules; no build step.

```sh
python3 -m http.server 8000
```

The program lives in `js/program.js`. Bump `CACHE` in `sw.js` on every deploy so installed apps pick up the new files.
