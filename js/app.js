import { WORKOUTS, ROTATION, PLAN, GUIDELINES } from './program.js';

const STORE_KEY = 'lift-log:v1';
const TABS = ['train', 'history', 'guide'];
const STAY_AWAKE_AFTER_LAST_SET_MS = 20 * 60_000;
const FORGET_TIMER_AFTER_S = 5 * 60;
const TIMER_TICK_MS = 250;

const ICONS = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
};

const $ = (selector, root = document) => root.querySelector(selector);
const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const shortDate = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

const store = loadStore();
let renderedForDate = null;
let timerInterval = null;
let audioContext = null;
let wakeLock = null;
let toastTimeout = null;

function loadStore() {
  const fresh = { sessions: {}, timer: null, tab: 'train', selection: null, lastLogAt: null };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    return saved?.sessions ? { ...fresh, ...saved } : fresh;
  } catch {
    return fresh;
  }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    toast('Could not save: storage is full or blocked');
  }
}

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const dayNumber = (workoutId) => ROTATION.indexOf(workoutId) + 1;

function fromIso(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

const formatNumber = (n) => numberFormat.format(n);
const formatRange = ([low, high]) => (low === high ? `${low}` : `${low}–${high}`);
const clock = (seconds) => `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`;

function parseWeight(text) {
  const value = Number.parseFloat(text.replace(',', '.'));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function parseReps(text) {
  const value = Number.parseInt(text, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function formatRest([min, max]) {
  const wholeMinutes = min >= 120 && min % 60 === 0 && max % 60 === 0;
  return wholeMinutes ? `${formatRange([min / 60, max / 60])} min` : `${formatRange([min, max])} sec`;
}

function formatEntry(entry) {
  if (entry.w == null) return entry.r == null ? 'done' : `${entry.r} reps`;
  return `${formatNumber(entry.w)} × ${entry.r ?? '–'}`;
}

function stepsOf(workout) {
  const steps = [];
  workout.blocks.forEach((block, blockIndex) => {
    const rounds = Math.max(...block.exercises.map((exercise) => exercise.sets));
    for (let set = 0; set < rounds; set++) {
      block.exercises.forEach((exercise, position) => {
        if (set >= exercise.sets) return;
        const endsRound = position === block.exercises.length - 1;
        steps.push({ blockIndex, position, exercise, set, restAfter: endsRound ? block.rest : null });
      });
    }
  });
  return steps;
}

const sessionKey = (date, workoutId) => `${date}_${workoutId}`;

function todaysSession(workoutId, { create = false } = {}) {
  const date = isoDate();
  const key = sessionKey(date, workoutId);
  if (!store.sessions[key] && create) {
    store.sessions[key] = { key, date, workoutId, sets: {}, startedAt: null, finishedAt: null, updatedAt: Date.now() };
  }
  return store.sessions[key] ?? null;
}

const entryOf = (session, exerciseId, set) => session?.sets[exerciseId]?.[set] ?? null;
const isStepDone = (session, step) => Boolean(entryOf(session, step.exercise.id, step.set)?.done);

function writeEntry(session, exerciseId, set, patch) {
  const entries = (session.sets[exerciseId] ??= []);
  entries[set] = { w: null, r: null, done: false, ...entries[set], ...patch };
  session.updatedAt = Date.now();
}

function previousSets(exerciseId, excludeKey) {
  let latest = null;
  for (const session of Object.values(store.sessions)) {
    if (session.key === excludeKey || !session.sets[exerciseId]?.some((entry) => entry?.done)) continue;
    const isNewer = !latest || session.date > latest.date || (session.date === latest.date && session.updatedAt > latest.updatedAt);
    if (isNewer) latest = session;
  }
  return latest ? latest.sets[exerciseId].map((entry) => (entry?.done ? entry : null)) : null;
}

function previousEntry(previous, set) {
  if (!previous) return null;
  return previous[set] ?? previous.filter(Boolean).at(-1) ?? null;
}

function shouldAddWeight(exercise, previous) {
  const done = previous?.filter(Boolean) ?? [];
  return done.length >= exercise.sets && done.every((entry) => (entry.r ?? 0) >= exercise.reps[1]);
}

function nextOpenStep(steps, session) {
  let latestIndex = -1;
  let latestAt = -1;
  steps.forEach((step, index) => {
    const entry = entryOf(session, step.exercise.id, step.set);
    if (entry?.done && (entry.doneAt ?? 0) >= latestAt) {
      latestIndex = index;
      latestAt = entry.doneAt ?? 0;
    }
  });
  const isOpen = (step) => !isStepDone(session, step);
  return steps.slice(latestIndex + 1).find(isOpen) ?? steps.find(isOpen) ?? null;
}

function sessionStats(workout, session) {
  const done = stepsOf(workout)
    .map((step) => entryOf(session, step.exercise.id, step.set))
    .filter((entry) => entry?.done);
  return { sets: done.length, volume: done.reduce((sum, entry) => sum + (entry.w ?? 0) * (entry.r ?? 0), 0) };
}

const nextInRotation = (workoutId) => ROTATION[(ROTATION.indexOf(workoutId) + 1) % ROTATION.length];
const isSkipped = (session) => session?.skipped === true;
const isLogged = (session) => sessionStats(WORKOUTS[session.workoutId], session).sets > 0;
// Not updatedAt: editing an earlier workout would make it look newer than a later one, or than a later skip.
const rotationTime = (session) => (isSkipped(session) ? session.skippedAt : session.startedAt) ?? session.updatedAt ?? 0;
const newestFirst = (a, b) => b.date.localeCompare(a.date) || rotationTime(b) - rotationTime(a);

// A skipped day moves the rotation on just like a trained one.
function rotationSessions() {
  return Object.values(store.sessions)
    .filter((session) => WORKOUTS[session.workoutId] && (isSkipped(session) || isLogged(session)))
    .sort(newestFirst);
}

const loggedSessions = () => rotationSessions().filter((session) => !isSkipped(session));

function suggestedWorkoutId() {
  const [latest] = rotationSessions();
  if (!latest) return ROTATION[0];
  return latest.date === isoDate() ? latest.workoutId : nextInRotation(latest.workoutId);
}

function selectedWorkoutId() {
  const { selection } = store;
  return selection?.date === isoDate() && WORKOUTS[selection.workoutId] ? selection.workoutId : suggestedWorkoutId();
}

function lastDoneBeforeToday(workoutId) {
  return loggedSessions().find((session) => session.workoutId === workoutId && session.date !== isoDate()) ?? null;
}

function render() {
  renderedForDate = isoDate();
  if (!TABS.includes(store.tab)) store.tab = 'train';
  for (const tab of TABS) $(`#view-${tab}`).hidden = tab !== store.tab;
  document.querySelectorAll('.tab').forEach((button) => {
    if (button.dataset.tab === store.tab) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  ({ train: renderTrain, history: renderHistory, guide: renderGuide })[store.tab]();
}

function renderTrain() {
  const workoutId = selectedWorkoutId();
  $('#view-train').innerHTML = dayPicker(workoutId) + workoutView(workoutId);
}

function dayPicker(selectedId) {
  const days = ROTATION.map((workoutId) => {
    const workout = WORKOUTS[workoutId];
    const session = todaysSession(workoutId);
    const { sets } = session ? sessionStats(workout, session) : { sets: 0 };
    const status = isSkipped(session) ? 'is-skipped' : sets === 0 ? null : sets === stepsOf(workout).length ? 'is-done' : 'is-partial';
    const classes = ['day', workoutId === selectedId && 'is-selected', status].filter(Boolean).join(' ');
    return `<button class="${classes}" data-workout="${workoutId}" aria-pressed="${workoutId === selectedId}">
      <span class="day-name">Day ${dayNumber(workoutId)}</span>
      <span class="day-plan">${workout.name}</span>
    </button>`;
  });
  return `<nav class="days" aria-label="Training day">${days.join('')}</nav>`;
}

function workoutView(workoutId) {
  const workout = WORKOUTS[workoutId];
  const session = todaysSession(workoutId);
  const steps = stepsOf(workout);
  const done = steps.filter((step) => isStepDone(session, step)).length;
  const next = nextOpenStep(steps, session);
  const exerciseCount = workout.blocks.reduce((count, block) => count + block.exercises.length, 0);
  const lastDone = lastDoneBeforeToday(workoutId);
  const eyebrow = `Day ${dayNumber(workoutId)} · ${lastDone ? `last done ${shortDate.format(fromIso(lastDone.date))}` : 'first session'}`;
  const hero = `
    <header class="hero">
      <p class="eyebrow">${eyebrow}</p>
      <h1>${workout.name}</h1>
      <p class="sub">${[workout.focus, `${exerciseCount} exercises`, PLAN.sessionLength].map((part) => `<span class="nowrap">${part}</span>`).join(' · ')}</p>
      ${isSkipped(session) ? '' : `
      <div class="progress" role="progressbar" aria-label="Sets done" aria-valuemin="0" aria-valuemax="${steps.length}" aria-valuenow="${done}">
        <span style="width:${(done / steps.length) * 100}%"></span>
      </div>
      <div class="progress-row">
        <p class="progress-label">${done === steps.length ? 'All sets done' : `${done} of ${steps.length} sets`}</p>
        ${done === 0 ? '<button class="link-skip" data-action="skip-day">Skip this day</button>' : ''}
      </div>`}
    </header>`;

  if (isSkipped(session)) return hero + skippedCard(workoutId);

  return `
    ${hero}
    ${done === 0 ? '<p class="note"><strong>Warm up first:</strong> 5–7 min easy cardio or mobility, then 2–3 lighter sets before the first lift. Don’t log warm-up sets.</p>' : ''}
    <ol class="blocks">${workout.blocks.map((block, index) => blockCard(block, index, steps, session, next)).join('')}</ol>
    ${done === steps.length ? doneCard(workout, session) : ''}
    ${session ? `<button class="link-danger" data-action="reset-session">Clear today’s ${workout.name} log</button>` : ''}`;
}

function blockCard(block, blockIndex, steps, session, next) {
  const blockSteps = steps.filter((step) => step.blockIndex === blockIndex);
  const isSuperset = block.exercises.length > 1;
  const isDone = blockSteps.every((step) => isStepDone(session, step));
  const isCurrent = next?.blockIndex === blockIndex;
  const previous = Object.fromEntries(block.exercises.map((exercise) => [exercise.id, previousSets(exercise.id, session?.key)]));

  const hints = block.exercises
    .filter((exercise) => shouldAddWeight(exercise, previous[exercise.id]))
    .map((exercise) => `<p class="hint">${ICONS.up}<span>${isSuperset ? `${exercise.name}: top` : 'Top'} of the range on every set last time. Add a little weight.</span></p>`)
    .join('');

  const rows = blockSteps.map((step) => {
    const roundLabel = isSuperset && step.position === 0 ? `<p class="round">Round ${step.set + 1}</p>` : '';
    const label = isSuperset ? `A${step.position + 1}` : `${step.set + 1}`;
    return roundLabel + setRow(step, label, session, previous[step.exercise.id], step === next);
  });

  const classes = ['block', isSuperset && 'is-superset', isDone && 'is-done', isCurrent && 'is-current'].filter(Boolean).join(' ');
  return `
    <li class="${classes}" data-block="${blockIndex}">
      <div class="block-head">
        <span class="block-num">${isDone ? ICONS.check : blockIndex + 1}</span>
        <div class="block-title">${isSuperset ? supersetTitle(block) : singleTitle(block)}</div>
      </div>
      ${hints}
      <div class="sets">
        <div class="set-head" aria-hidden="true"><span>${isSuperset ? '' : 'Set'}</span><span>Last time</span><span>kg</span><span>Reps</span><span></span></div>
        ${rows.join('')}
      </div>
    </li>`;
}

function singleTitle({ exercises: [exercise], rest }) {
  return `
    <h2>${exercise.name}</h2>
    <p class="meta">
      <span class="chip">${exercise.sets} × ${formatRange(exercise.reps)}</span>
      <span class="chip chip-rest">${ICONS.clock}Rest ${formatRest(rest)}</span>
    </p>`;
}

function supersetTitle({ exercises, rest }) {
  const rounds = Math.max(...exercises.map((exercise) => exercise.sets));
  const list = exercises
    .map((exercise, index) => `<li><span class="tag">A${index + 1}</span><span><strong>${exercise.name}</strong> <span class="muted">${exercise.sets} × ${formatRange(exercise.reps)}</span></span></li>`)
    .join('');
  return `
    <p class="kicker">Superset · ${rounds} rounds</p>
    <ul class="superset-list">${list}</ul>
    <p class="meta">
      <span class="chip">No rest between</span>
      <span class="chip chip-rest">${ICONS.clock}Rest ${formatRest(rest)} after both</span>
    </p>`;
}

function setRow(step, label, session, previous, isNext) {
  const { exercise, set } = step;
  const entry = entryOf(session, exercise.id, set);
  const last = previousEntry(previous, set);
  const classes = ['set', entry?.done && 'is-done', isNext && 'is-next'].filter(Boolean).join(' ');
  const what = `${exercise.name}, set ${set + 1}`;
  return `
    <div class="${classes}" data-exercise="${exercise.id}" data-set="${set}">
      <span class="set-label">${label}</span>
      <span class="set-prev">${last ? formatEntry(last) : '—'}</span>
      <input class="set-input" data-field="w" inputmode="decimal" enterkeyhint="next" autocomplete="off" aria-label="${what}: weight in kg"
        placeholder="${last?.w != null ? formatNumber(last.w) : 'kg'}" value="${entry?.w != null ? formatNumber(entry.w) : ''}">
      <input class="set-input" data-field="r" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" autocomplete="off" aria-label="${what}: reps"
        placeholder="${last?.r ?? formatRange(exercise.reps)}" value="${entry?.r ?? ''}">
      <button class="check" data-action="toggle-set" aria-pressed="${Boolean(entry?.done)}" aria-label="${what} done">${ICONS.check}</button>
    </div>`;
}

function doneCard(workout, session) {
  const { sets, volume } = sessionStats(workout, session);
  const minutes = session.startedAt && session.finishedAt ? Math.max(1, Math.round((session.finishedAt - session.startedAt) / 60_000)) : null;
  const next = nextInRotation(session.workoutId);
  return `
    <section class="card done-card">
      <p class="eyebrow accent">Workout complete</p>
      <h2>Nice work 💪</h2>
      <dl class="stats">
        <div><dt>Time</dt><dd>${minutes ? `${minutes} min` : '–'}</dd></div>
        <div><dt>Sets</dt><dd>${sets}</dd></div>
        <div><dt>Volume</dt><dd>${formatNumber(Math.round(volume))} kg</dd></div>
      </dl>
      <p class="sub">Next session: <strong>Day ${dayNumber(next)} · ${WORKOUTS[next].name}</strong></p>
    </section>`;
}

function skippedCard(workoutId) {
  const next = nextInRotation(workoutId);
  return `
    <section class="card skipped-card">
      <p class="eyebrow">Skipped today</p>
      <h2>Next up: Day ${dayNumber(next)} · ${WORKOUTS[next].name}</h2>
      <p class="sub">Made it after all? Undo the skip to log this workout.</p>
      <div class="actions"><button class="btn" data-action="undo-skip">Undo skip</button></div>
    </section>`;
}

function renderHistory() {
  const sessions = rotationSessions();
  const logged = sessions.filter((session) => !isSkipped(session)).length;
  const skipped = sessions.length - logged;
  const summary = [
    logged ? `${logged} workout${logged === 1 ? '' : 's'} logged` : 'Nothing logged yet',
    skipped && `${skipped} skipped`,
  ].filter(Boolean).join(' · ');

  $('#view-history').innerHTML = `
    <header class="page-head">
      <p class="eyebrow">Your log</p>
      <h1>History</h1>
      <p class="sub">${summary}</p>
    </header>
    ${sessions.length
      ? `<ul class="history">${sessions.map((session) => (isSkipped(session) ? skippedItem(session) : historyItem(session))).join('')}</ul>`
      : '<section class="card"><p class="sub">Log your first set on the Train tab and it shows up here.</p></section>'}
    <section class="card">
      <h2>Backup</h2>
      <p class="sub">Your log is stored on this phone only. Export a backup now and then; import it on a new phone.</p>
      <div class="actions">
        <button class="btn btn-primary" data-action="export">Export</button>
        <label class="btn">Import<input id="import-file" type="file" accept="application/json,.json" hidden></label>
      </div>
    </section>`;
}

function historyItem(session) {
  const workout = WORKOUTS[session.workoutId];
  const total = stepsOf(workout).length;
  const { sets, volume } = sessionStats(workout, session);
  const rows = workout.blocks
    .flatMap((block) => block.exercises)
    .map((exercise) => {
      const done = (session.sets[exercise.id] ?? []).filter((entry) => entry?.done);
      const entries = done.map((entry) => `<span class="nowrap">${formatEntry(entry)}</span>`).join(' · ');
      return done.length ? `<li class="history-row"><span>${exercise.name}</span><span>${entries}</span></li>` : '';
    })
    .join('');
  return `
    <li>
      <details>
        <summary>
          <span><strong>${workout.name}</strong><small>${shortDate.format(fromIso(session.date))}${volume ? ` · ${formatNumber(Math.round(volume))} kg` : ''}</small></span>
          <span class="pill${sets === total ? ' is-complete' : ''}">${sets}/${total} sets</span>
        </summary>
        <div class="history-body">
          <ul>${rows}</ul>
          <button class="link-danger" data-action="delete-session" data-key="${session.key}">Delete this workout</button>
        </div>
      </details>
    </li>`;
}

function skippedItem(session) {
  return `
    <li>
      <details>
        <summary>
          <span><strong>${WORKOUTS[session.workoutId].name}</strong><small>${shortDate.format(fromIso(session.date))}</small></span>
          <span class="pill is-skipped">Skipped</span>
        </summary>
        <div class="history-body">
          <button class="link-danger" data-action="delete-session" data-key="${session.key}">Remove this skip</button>
        </div>
      </details>
    </li>`;
}

function renderGuide() {
  const schedule = ROTATION.map((workoutId) => `
    <li><span>Day ${dayNumber(workoutId)}</span><strong>${WORKOUTS[workoutId].name} <small>${WORKOUTS[workoutId].focus}</small></strong></li>`).join('');

  $('#view-guide').innerHTML = `
    <header class="page-head">
      <p class="eyebrow">The plan</p>
      <h1>${PLAN.title}</h1>
      <p class="sub">${PLAN.subtitle}</p>
    </header>
    <section class="card">
      <h2>Training days</h2>
      <ul class="schedule">${schedule}</ul>
      <p class="sub closing">${PLAN.restDays}</p>
    </section>
    <section class="card">
      <h2>Training guidelines</h2>
      <dl class="guidelines">${GUIDELINES.map(({ title, text }) => `<dt>${title}</dt><dd>${text}</dd>`).join('')}</dl>
      <p class="sub closing">${PLAN.closing}</p>
    </section>
    <section class="card">
      <h2>Using the app</h2>
      <ul class="howto">
        <li>Train opens the next day in the rotation. Doing a different one? Tap Day 1–4 at the top.</li>
        <li>Can’t make it? Tap <em>Skip this day</em> and the rotation moves on to the next day.</li>
        <li>Exercises are listed in order. Enter kg and reps, then tap ✓. An empty field copies last time’s value.</li>
        <li>✓ starts the rest timer. It beeps when the minimum rest is over, and again at the maximum.</li>
        <li>Supersets: do A1, go straight to A2, then rest.</li>
        <li><em>Add a little weight</em> shows up when you hit the top of the rep range on every set last time.</li>
        <li>Install: in Safari tap Share → Add to Home Screen. It then runs full screen and works offline.</li>
      </ul>
    </section>`;
}

function selectWorkout(workoutId) {
  store.selection = { date: isoDate(), workoutId };
  save();
  renderTrain();
  window.scrollTo({ top: 0 });
}

function selectTab(tab) {
  store.tab = tab;
  save();
  render();
  window.scrollTo({ top: 0 });
}

function saveField(input) {
  const row = input.closest('.set');
  const session = todaysSession(selectedWorkoutId(), { create: true });
  const value = input.dataset.field === 'w' ? parseWeight(input.value) : parseReps(input.value);
  writeEntry(session, row.dataset.exercise, Number(row.dataset.set), { [input.dataset.field]: value });
  save();
}

function toggleSet(row) {
  unlockAudio();
  const workoutId = selectedWorkoutId();
  const workout = WORKOUTS[workoutId];
  const session = todaysSession(workoutId, { create: true });
  const exerciseId = row.dataset.exercise;
  const set = Number(row.dataset.set);
  const entry = entryOf(session, exerciseId, set);

  if (entry?.done) {
    writeEntry(session, exerciseId, set, { done: false });
    session.finishedAt = null;
    save();
    renderTrain();
    return;
  }

  const last = previousEntry(previousSets(exerciseId, session.key), set);
  writeEntry(session, exerciseId, set, {
    w: entry?.w ?? last?.w ?? null,
    r: entry?.r ?? last?.r ?? null,
    done: true,
    doneAt: Date.now(),
  });
  session.startedAt ??= Date.now();
  store.lastLogAt = Date.now();

  const steps = stepsOf(workout);
  const logged = steps.find((step) => step.exercise.id === exerciseId && step.set === set);
  announceNextStep(steps, session, logged);
  save();
  renderTrain();
  scrollToNext(logged.blockIndex, session);
}

function announceNextStep(steps, session, logged) {
  const next = nextOpenStep(steps, session);
  if (!next) {
    session.finishedAt = Date.now();
    store.lastLogAt = null;
    stopTimer();
    releaseWakeLock();
    toast('Workout complete. Nice work!');
    return;
  }
  keepAwake();
  if (!logged.restAfter) {
    stopTimer();
    toast(`Superset: straight to ${next.exercise.name}`);
    return;
  }
  startTimer(logged.restAfter, `Next: ${next.exercise.name} · set ${next.set + 1}`);
}

function scrollToNext(loggedBlockIndex, session) {
  if (session.finishedAt) {
    $('.done-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const nextBlock = $('.set.is-next')?.closest('.block');
  if (nextBlock && Number(nextBlock.dataset.block) !== loggedBlockIndex) {
    nextBlock.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function resetSession() {
  const workoutId = selectedWorkoutId();
  const session = todaysSession(workoutId);
  if (!session || !confirm(`Clear today’s ${WORKOUTS[workoutId].name} log?`)) return;
  delete store.sessions[session.key];
  stopTimer();
  save();
  renderTrain();
}

function skipDay() {
  const workoutId = selectedWorkoutId();
  const session = todaysSession(workoutId, { create: true });
  if (isLogged(session)) return;
  session.skipped = true;
  session.skippedAt = Date.now();
  session.updatedAt = session.skippedAt;
  save();
  renderTrain();
  window.scrollTo({ top: 0 });
  const next = nextInRotation(workoutId);
  toast(`Day ${dayNumber(workoutId)} skipped. Next up: Day ${dayNumber(next)}`);
}

function undoSkip() {
  const session = todaysSession(selectedWorkoutId());
  if (!isSkipped(session)) return;
  delete session.skipped;
  delete session.skippedAt;
  session.updatedAt = Date.now();
  if (Object.keys(session.sets).length === 0) delete store.sessions[session.key];
  save();
  renderTrain();
}

function deleteSession(key) {
  const session = store.sessions[key];
  if (!session) return;
  const action = isSkipped(session) ? 'Remove the skip of' : 'Delete';
  if (!confirm(`${action} ${WORKOUTS[session.workoutId].name} from ${shortDate.format(fromIso(session.date))}?`)) return;
  delete store.sessions[key];
  save();
  renderHistory();
}

function startTimer([min, max], nextLabel) {
  store.timer = { startedAt: Date.now(), min, max, nextLabel, chimes: 0 };
  save();
  showTimer();
}

function stopTimer() {
  clearInterval(timerInterval);
  store.timer = null;
  save();
  $('#timer').hidden = true;
  document.body.classList.remove('has-timer');
}

function showTimer() {
  $('#timer').hidden = false;
  document.body.classList.add('has-timer');
  clearInterval(timerInterval);
  timerInterval = setInterval(tickTimer, TIMER_TICK_MS);
  tickTimer();
}

function adjustTimer(seconds) {
  const timer = store.timer;
  if (!timer) return;
  timer.startedAt -= seconds * 1000;
  const elapsed = (Date.now() - timer.startedAt) / 1000;
  if (elapsed < timer.min) timer.chimes = 0;
  else if (elapsed < timer.max) timer.chimes = Math.min(timer.chimes, 1);
  save();
  tickTimer();
}

function tickTimer() {
  const timer = store.timer;
  if (!timer) return stopTimer();
  const elapsed = (Date.now() - timer.startedAt) / 1000;
  if (elapsed > timer.max + FORGET_TIMER_AFTER_S) return stopTimer();

  const phase = elapsed < timer.min ? 'rest' : elapsed < timer.max ? 'ready' : 'go';
  const display = {
    rest: { label: `Rest · ${formatRest([timer.min, timer.max])}`, time: clock(Math.ceil(timer.min - elapsed)) },
    ready: { label: 'Ready · max rest in', time: clock(Math.ceil(timer.max - elapsed)) },
    go: { label: 'Rest is over · go', time: `+${clock(Math.floor(elapsed - timer.max))}` },
  }[phase];

  const element = $('#timer');
  element.classList.toggle('is-ready', phase === 'ready');
  element.classList.toggle('is-go', phase === 'go');
  $('#timer-label').textContent = display.label;
  $('#timer-time').textContent = display.time;
  $('#timer-next').textContent = timer.nextLabel;
  $('#timer-fill').style.width = `${Math.min(Math.max(elapsed, 0) / timer.max, 1) * 100}%`;
  $('#timer-tick').style.left = `${(timer.min / timer.max) * 100}%`;
  $('#timer-tick').hidden = timer.min === timer.max;

  const chimesDue = { rest: 0, ready: 1, go: timer.min === timer.max ? 1 : 2 }[phase];
  if (chimesDue > timer.chimes) {
    chime(chimesDue === 2 ? 3 : 2);
    timer.chimes = chimesDue;
    save();
  }
}

// iOS only lets Web Audio play after a context is created or resumed inside a user gesture.
function unlockAudio() {
  try {
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state !== 'running') audioContext.resume();
  } catch {
    audioContext = null;
  }
}

function chime(beeps) {
  if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(beeps * 120);
  if (audioContext?.state !== 'running') return;
  const start = audioContext.currentTime + 0.02;
  for (let i = 0; i < beeps; i++) {
    const at = start + i * 0.25;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = i === beeps - 1 ? 1320 : 880;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.35, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.22);
  }
}

async function keepAwake() {
  if (wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
    });
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    element.hidden = true;
  }, 2600);
}

async function exportBackup() {
  const json = JSON.stringify({ app: 'lift-log', version: 1, exportedAt: new Date().toISOString(), sessions: store.sessions }, null, 2);
  const file = new File([json], `lift-log-${isoDate()}.json`, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: 'Lift Log backup' }).catch(() => {});
    return;
  }
  const url = URL.createObjectURL(file);
  Object.assign(document.createElement('a'), { href: url, download: file.name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const numberOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function sanitizeSessions(raw) {
  const clean = {};
  for (const session of Object.values(raw ?? {})) {
    if (!session || !WORKOUTS[session.workoutId] || !/^\d{4}-\d{2}-\d{2}$/.test(session.date)) continue;
    const sets = {};
    for (const [exerciseId, entries] of Object.entries(session.sets ?? {})) {
      if (!Array.isArray(entries)) continue;
      sets[exerciseId] = entries.map((entry) => entry && {
        w: numberOrNull(entry.w),
        r: numberOrNull(entry.r),
        done: entry.done === true,
        doneAt: numberOrNull(entry.doneAt),
      });
    }
    const key = sessionKey(session.date, session.workoutId);
    const cleanSession = {
      key,
      date: session.date,
      workoutId: session.workoutId,
      sets,
      startedAt: numberOrNull(session.startedAt),
      finishedAt: numberOrNull(session.finishedAt),
      updatedAt: numberOrNull(session.updatedAt) ?? 0,
    };
    if (session.skipped === true && !isLogged(cleanSession)) {
      Object.assign(cleanSession, { skipped: true, skippedAt: numberOrNull(session.skippedAt) });
    }
    clean[key] = cleanSession;
  }
  return clean;
}

async function importBackup(input) {
  const [file] = input.files ?? [];
  input.value = '';
  if (!file) return;
  try {
    const sessions = sanitizeSessions(JSON.parse(await file.text()).sessions);
    const count = Object.keys(sessions).length;
    if (!count) throw new Error('No workouts in file');
    if (!confirm(`Import ${count} workout${count === 1 ? '' : 's'}? Workouts on the same date and day get replaced.`)) return;
    Object.assign(store.sessions, sessions);
    save();
    render();
    toast(`Imported ${count} workout${count === 1 ? '' : 's'}`);
  } catch {
    toast('That file is not a Lift Log backup');
  }
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.workout) return selectWorkout(button.dataset.workout);
  if (button.dataset.tab) return selectTab(button.dataset.tab);
  const actions = {
    'toggle-set': () => toggleSet(button.closest('.set')),
    'reset-session': resetSession,
    'skip-day': skipDay,
    'undo-skip': undoSkip,
    'timer-adjust': () => adjustTimer(Number(button.dataset.seconds)),
    'timer-skip': stopTimer,
    'delete-session': () => deleteSession(button.dataset.key),
    export: exportBackup,
  };
  actions[button.dataset.action]?.();
});

document.addEventListener('input', (event) => {
  if (event.target.matches('.set-input')) saveField(event.target);
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'import-file') importBackup(event.target);
});

// The keyboard covers the bottom of the screen, so the tab bar and timer only get in the way while typing.
document.addEventListener('focusin', (event) => {
  if (event.target.matches('.set-input')) document.body.classList.add('is-typing');
});

document.addEventListener('focusout', () => {
  setTimeout(() => {
    if (!document.activeElement?.matches('.set-input')) document.body.classList.remove('is-typing');
  });
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (renderedForDate !== isoDate()) render();
  if (store.timer) tickTimer();
  if (store.lastLogAt && Date.now() - store.lastLogAt < STAY_AWAKE_AFTER_LAST_SET_MS) keepAwake();
});

render();
if (store.timer) showTimer();
if ('serviceWorker' in navigator) {
  const isUpdate = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (isUpdate) location.reload();
  });
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
