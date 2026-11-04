const MINUTE = 60;

const REST = {
  heavy: [2 * MINUTE, 3 * MINUTE],
  twoMinutes: [2 * MINUTE, 2 * MINUTE],
  ninetySeconds: [90, 90],
  short: [60, 90],
};

// step: smallest realistic weight jump in kg (dumbbell pair steps, plate or pin stack increments).
const STEP = { dumbbell: 2, stack: 2.5, barbell: 2.5, heavy: 5 };

const exercise = (id, name, sets, reps, step) => ({ id, name, sets, reps, step });
const single = (id, name, sets, reps, rest, step) => ({ rest, exercises: [exercise(id, name, sets, reps, step)] });
const superset = (rest, ...exercises) => ({ rest, exercises });

// Exercises shared by both lower days use the same id, so last session's weight carries over between them.
export const WORKOUTS = {
  upperA: {
    name: 'Upper A',
    short: 'Up A',
    focus: 'Chest, back, shoulders & arms',
    blocks: [
      single('db-chest-press', 'Dumbbell chest press', 3, [6, 10], REST.heavy, STEP.dumbbell),
      single('seated-cable-row', 'Seated cable row', 3, [8, 12], REST.twoMinutes, STEP.stack),
      single('pullup-or-lat-pulldown', 'Pull-up or lat pulldown', 3, [6, 10], REST.twoMinutes, STEP.stack),
      single('db-shoulder-press', 'Dumbbell shoulder press', 2, [8, 12], REST.twoMinutes, STEP.dumbbell),
      single('db-lateral-raise', 'Dumbbell lateral raise', 2, [12, 20], REST.short, STEP.dumbbell),
      superset(
        REST.short,
        exercise('db-bicep-curl', 'Dumbbell bicep curl', 2, [10, 15], STEP.dumbbell),
        exercise('rope-triceps-extension', 'Rope triceps extension', 2, [10, 15], STEP.stack),
      ),
    ],
  },
  lowerA: {
    name: 'Lower A',
    short: 'Low A',
    focus: 'Quad emphasis',
    blocks: [
      single('squat-or-leg-press', 'Squat or leg press', 3, [6, 10], REST.heavy, STEP.heavy),
      single('bulgarian-split-squat', 'Bulgarian split squat', 3, [8, 12], REST.twoMinutes, STEP.dumbbell),
      single('leg-curl', 'Leg curl', 3, [10, 15], REST.ninetySeconds, STEP.stack),
      single('leg-extension', 'Leg extension', 2, [10, 15], REST.short, STEP.stack),
      single('standing-calf-raise', 'Standing calf raise (dumbbells or machine)', 3, [10, 20], REST.short, STEP.stack),
      single('cable-crunch-or-abs', 'Cable crunch or another ab exercise', 2, [10, 15], REST.short, STEP.stack),
    ],
  },
  upperB: {
    name: 'Upper B',
    short: 'Up B',
    focus: 'Chest, back, shoulders & arms',
    blocks: [
      single('incline-db-chest-press', 'Incline dumbbell chest press', 3, [8, 12], REST.heavy, STEP.dumbbell),
      single('barbell-or-chest-supported-row', 'Barbell row or chest-supported row', 3, [8, 12], REST.twoMinutes, STEP.barbell),
      single('lat-pulldown', 'Lat pulldown', 3, [8, 12], REST.twoMinutes, STEP.stack),
      single('cable-or-db-lateral-raise', 'Cable or dumbbell lateral raise', 3, [12, 20], REST.short, STEP.dumbbell),
      single('rear-delt-fly', 'Rear-delt fly (dumbbells or cable)', 2, [12, 20], REST.short, STEP.dumbbell),
      superset(
        REST.short,
        exercise('barbell-bicep-curl', 'Barbell bicep curl', 2, [8, 12], STEP.barbell),
        exercise('db-skull-crusher', 'Dumbbell skull crushers', 2, [10, 15], STEP.dumbbell),
      ),
    ],
  },
  lowerB: {
    name: 'Lower B',
    short: 'Low B',
    focus: 'Hamstring emphasis',
    blocks: [
      single('romanian-deadlift', 'Romanian deadlift (barbell or dumbbells)', 3, [6, 10], REST.heavy, STEP.barbell),
      single('leg-press', 'Leg press', 3, [10, 12], REST.twoMinutes, STEP.heavy),
      single('leg-curl', 'Leg curl', 3, [10, 15], REST.ninetySeconds, STEP.stack),
      single('leg-extension', 'Leg extension', 2, [12, 15], REST.short, STEP.stack),
      single('standing-calf-raise', 'Standing calf raise', 3, [10, 20], REST.short, STEP.stack),
      single('hanging-knee-raise-or-cable-crunch', 'Hanging knee raise or cable crunch', 2, [10, 15], REST.short, STEP.stack),
    ],
  },
};

export const ROTATION = ['upperA', 'lowerA', 'upperB', 'lowerB'];

export const PLAN = {
  title: '4-Day Muscle Growth',
  subtitle: 'Upper / Lower split · 45–60 minutes per session · balanced full-body development',
  sessionLength: '45–60 min',
  restDays: 'Four sessions a week, in this order. Take a rest day after Day 2 and two after Day 4; an easy walk or bike ride on rest days is fine.',
  closing: 'Use this plan consistently for 8–12 weeks, track loads and reps, and adjust if recovery or technique suffers.',
};

export const GUIDELINES = [
  {
    title: 'Warm-up',
    text: '5–7 minutes easy cardio/mobility, then 2–3 gradually heavier warm-up sets before the first major lift. Warm-up sets do not count as working sets.',
  },
  {
    title: 'Effort',
    text: 'Finish most working sets with about 1–3 reps in reserve (good reps you could still do). Keep technique controlled.',
  },
  {
    title: 'Progression',
    text: 'Use the listed rep range. When you reach the top of the range on every set with good form, increase the load slightly and build reps again.',
  },
  {
    title: 'Time-saving supersets',
    text: 'Pair curls with triceps extensions; optionally pair calf raises with abs. Do one set of each, then rest the listed time.',
  },
  {
    title: 'Equipment alternatives',
    text: 'No seated calf machine needed — do standing calf raises holding dumbbells, ideally on a step. No hip thrusts are included; squats, split squats and Romanian deadlifts train glutes.',
  },
  {
    title: 'Session timing',
    text: 'Keep heavy compound lifts’ rests full; if short on time, superset only the listed isolation/accessory movements.',
  },
];
