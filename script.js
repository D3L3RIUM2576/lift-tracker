const defaultSplit = [
    {
        id: "push",
        name: "Push",
        exerciseIds: ["barbell-bench-press", "incline-dumbbell-press", "dumbbell-shoulder-press", "seated-dumbbell-lateral-raise", "cable-lateral-raise", "v-bar-tricep-pushdown", "overhead-v-bar-tricep-extension"]
    },
    {
        id: "pull",
        name: "Pull",
        exerciseIds: ["pull-up", "lat-pulldown", "seated-cable-row", "straight-arm-pulldown", "face-pull", "incline-curl", "rope-hammer-curl", "single-arm-rear-delt-cable-fly"]
    },
    {
        id: "legs",
        name: "Legs",
        exerciseIds: ["leg-press", "seated-leg-curl", "leg-extension", "lying-leg-curl", "single-leg-box-squat", "dumbbell-rdl", "cable-crunch", "hanging-leg-raise"]
    },
    { id: "rest", name: "Rest", isRest: true, exerciseIds: [] }
];

const catalogById = new Map(EXERCISE_CATALOG.map((exercise) => [exercise.id, exercise]));

const STATE_KEY = "liftTrackerScheduleStateV2";
const HISTORY_KEY = "liftTrackerWorkoutHistoryV2";
const DRAFT_PREFIX = "liftTrackerDraftV2:";
const BODYWEIGHT_KEY = "liftTrackerBodyweightV1";
const PHASES_KEY = "liftTrackerTrainingPhasesV1";
const GOALS_KEY = "liftTrackerStrengthGoalsV1";
const ACHIEVED_GOALS_KEY = "liftTrackerAchievedGoalsV1";
const EXERCISE_NOTES_KEY = "liftTrackerExerciseNotesV1";
const PROGRESS_LAYOUT_KEY = "liftTrackerProgressLayoutV1";
const UNIT_KEY = "liftTrackerWeightUnitV1";
const ONBOARDING_KEY = "liftTrackerOnboardingV1";
const AUTOSAVE_KEY = "liftTrackerAutosaveStableV1";
const RECAPS_KEY = "liftTrackerRecapsV1";
const RECAP_SHOWN_KEY = "liftTrackerRecapShownV1";

function restoreAutosaveIfNeeded() {
    const snapshot = loadJSON(AUTOSAVE_KEY, null);
    if (!snapshot?.data || (localStorage.getItem(STATE_KEY) && localStorage.getItem(HISTORY_KEY))) return false;
    Object.entries(snapshot.data).forEach(([key, value]) => {
        if (key.startsWith("liftTracker") && key !== AUTOSAVE_KEY && localStorage.getItem(key) === null && typeof value === "string") {
            localStorage.setItem(key, value);
        }
    });
    return true;
}

const autosaveRestored = restoreAutosaveIfNeeded();
let weightUnit = loadJSON(UNIT_KEY, "kg");
const today = startOfDay(new Date());
let viewedDate = today;
let calendarSelectedDate = today;
let calendarCursor = new Date(today.getFullYear(), today.getMonth(), 1);
let miniCalendarOffset = 0;
let state = loadState();
let history = loadJSON(HISTORY_KEY, {});
let scheduleUndo = null;
let scheduleUndoTimer = null;
let autosaveTimer = null;
let autosaveEnabled = true;
state.customExercises.forEach((exercise) => catalogById.set(exercise.id, exercise));

const exerciseList = document.querySelector("#exercise-list");
const workoutForm = document.querySelector("#workout-form");
const statusMessage = document.querySelector("#status-message");

function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function dateFromKey(key) {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day);
}

function addDays(date, amount) {
    const result = new Date(date);
    result.setDate(result.getDate() + amount);
    return startOfDay(result);
}

function daysBetween(first, second) {
    return Math.round((startOfDay(second) - startOfDay(first)) / 86400000);
}

function loadJSON(key, fallback) {
    try {
        return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
        localStorage.removeItem(key);
        return fallback;
    }
}

function escapeHTML(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
}

function displayWeight(kg) {
    return weightUnit === "lb" ? Number(kg) * 2.2046226218 : Number(kg);
}

function storedWeight(value) {
    return weightUnit === "lb" ? Number(value) / 2.2046226218 : Number(value);
}

function formatWeight(kg, decimals = 1) {
    const value = displayWeight(kg);
    return `${value.toLocaleString(undefined, { maximumFractionDigits: decimals })} ${weightUnit}`;
}

function formatVolume(kgVolume) {
    return `${Math.round(displayWeight(kgVolume)).toLocaleString()} ${weightUnit}`;
}

function loadState() {
    const saved = loadJSON(STATE_KEY, {});
    const savedSplit = saved.split || structuredClone(defaultSplit);
    savedSplit.forEach((day, index) => {
        day.id ||= `${day.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index}`;
        day.isRest = day.isRest || day.name === "Rest";
        day.exerciseIds ||= [];
    });
    return {
        startDate: saved.startDate || dateKey(today),
        trackingStartDate: saved.trackingStartDate || saved.startDate || dateKey(today),
        startingIndex: saved.startingIndex || 0,
        scheduleOffset: saved.scheduleOffset || 0,
        scheduleAdjustments: saved.scheduleAdjustments || [],
        splitName: saved.splitName || "Push Pull Legs",
        split: savedSplit,
        exerciseRules: saved.exerciseRules || [],
        customExercises: saved.customExercises || []
    };
}

function saveState() {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
    queueAutosave();
}

function saveHistory() {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    queueAutosave();
}

function writeAutosaveSnapshot() {
    if (!autosaveEnabled) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    const data = {};
    for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key?.startsWith("liftTracker") && key !== AUTOSAVE_KEY) data[key] = localStorage.getItem(key);
    }
    const savedAt = new Date().toISOString();
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ schema: 1, compatibleSince: 1, savedAt, data }));
    const status = document.querySelector("#autosave-status");
    if (status) status.textContent = `Autosaved on this device at ${new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(savedAt))}. Compatible with future Lift Tracker updates.`;
}

function queueAutosave() {
    if (!autosaveEnabled) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(writeAutosaveSnapshot, 500);
}

function scheduleSnapshot() {
    return { state: structuredClone(state), history: structuredClone(history) };
}

function offerScheduleUndo(message, snapshot) {
    scheduleUndo = snapshot;
    clearTimeout(scheduleUndoTimer);
    document.querySelector("#undo-message").textContent = message;
    document.querySelector("#undo-toast").hidden = false;
    scheduleUndoTimer = setTimeout(() => {
        scheduleUndo = null;
        document.querySelector("#undo-toast").hidden = true;
    }, 12000);
}

document.querySelector("#undo-schedule").addEventListener("click", () => {
    if (!scheduleUndo) return;
    state = structuredClone(scheduleUndo.state);
    history = structuredClone(scheduleUndo.history);
    saveState();
    saveHistory();
    scheduleUndo = null;
    clearTimeout(scheduleUndoTimer);
    document.querySelector("#undo-toast").hidden = true;
    renderWorkout();
    renderCalendar();
    statusMessage.textContent = "Schedule change undone.";
});

function scheduleIndexFor(date) {
    const startDate = dateFromKey(state.startDate);

    const missedBeforeDate = Object.values(history).filter((entry) => (
        entry.status === "missed" && dateFromKey(entry.date) >= startDate && dateFromKey(entry.date) < date
    )).length;
    const datedOffset = state.scheduleAdjustments
        .filter((adjustment) => dateKey(date) >= adjustment.effectiveDate)
        .reduce((sum, adjustment) => sum + adjustment.delta, 0);
    const rawIndex = state.startingIndex + state.scheduleOffset + datedOffset + daysBetween(startDate, date) - missedBeforeDate;
    return ((rawIndex % state.split.length) + state.split.length) % state.split.length;
}

function workoutForDate(date) {
    const index = scheduleIndexFor(date);
    if (index === null) return null;
    const day = state.split[index];
    const exerciseIds = exerciseIdsForDate(date, day);
    return {
        ...day,
        index,
        exerciseIds,
        exercises: exerciseIds.map((id) => catalogById.get(id)).filter(Boolean)
    };
}

function removeMissedEntriesNowOnRestDays() {
    let changed = false;
    for (let pass = 0; pass < state.split.length + 2; pass += 1) {
        const invalid = Object.values(history).find((entry) => entry.status === "missed" && workoutForDate(dateFromKey(entry.date)).isRest);
        if (!invalid) break;
        delete history[invalid.date];
        localStorage.removeItem(DRAFT_PREFIX + invalid.date);
        changed = true;
    }
    if (changed) saveHistory();
    return changed;
}

function exerciseIdsForDate(date, day) {
    const key = dateKey(date);
    const rules = state.exerciseRules.filter((rule) => rule.dayId === day.id || (!rule.dayId && rule.dayName === day.name));
    const once = rules.filter((rule) => rule.type === "once" && rule.date === key).at(-1);
    if (once) return once.exerciseIds;

    const range = rules.filter((rule) => (
        rule.type === "range" && key >= rule.startDate && key <= rule.endDate
    )).at(-1);
    if (range) return range.exerciseIds;

    const interval = rules.filter((rule) => {
        if (rule.type !== "interval" || key < rule.startDate) return false;
        const weeks = Math.floor(daysBetween(dateFromKey(rule.startDate), date) / 7);
        return weeks % rule.intervalWeeks === 0;
    }).at(-1);
    return interval ? interval.exerciseIds : day.exerciseIds;
}

function createSetRow(setNumber, values = {}) {
    const row = document.createElement("div");
    row.className = "set-row";
    row.innerHTML = `
        <span class="set-label">${setNumber}</span>
        <label>
            <span class="visually-hidden">Weight for set ${setNumber}</span>
            <input class="weight-input" type="number" min="0" step="0.5"
                placeholder="${weightUnit}" value="${values.weight == null || values.weight === "" ? "" : Number(displayWeight(values.weight).toFixed(2))}" aria-label="Weight for set ${setNumber} in ${weightUnit}">
        </label>
        <label>
            <span class="visually-hidden">Reps for set ${setNumber}</span>
            <input class="reps-input" type="number" min="0" step="1"
                placeholder="reps" value="${values.reps ?? ""}" aria-label="Reps for set ${setNumber}">
        </label>
        <button class="remove-set" type="button" aria-label="Remove set">×</button>
    `;

    row.querySelector(".remove-set").addEventListener("click", () => {
        const container = row.parentElement;
        if (container.children.length > 1) {
            row.remove();
            renumberSets(container);
            saveDraft();
            updateSummary();
            container.dispatchEvent(new Event("input", { bubbles: true }));
        }
    });
    row.querySelectorAll("input").forEach((input) => input.addEventListener("input", () => {
        saveDraft();
        updateSummary();
    }));
    return row;
}

function renumberSets(container) {
    [...container.children].forEach((row, index) => {
        const number = index + 1;
        row.querySelector(".set-label").textContent = number;
        row.querySelector(".weight-input").setAttribute("aria-label", `Weight for set ${number}`);
        row.querySelector(".reps-input").setAttribute("aria-label", `Reps for set ${number}`);
    });
}

function exerciseRestSeconds(exercise) {
    const compoundNames = /press|squat|deadlift|row|pull-up|chin-up|dip|leg press/i;
    if (exercise.equipment === "Barbell" || compoundNames.test(exercise.name)) return 180;
    if (["Cable", "Dumbbells", "Machine"].includes(exercise.equipment) && (exercise.secondaryMuscles || []).length) return 120;
    return 75;
}

function suggestedTarget(exercise, previous) {
    const sets = previous?.exercise?.sets?.filter((set) => set.weight > 0 && set.reps > 0) || [];
    if (!sets.length) return "Log a working set to create your first target.";
    const best = sets.reduce((top, set) => set.weight > top.weight || (set.weight === top.weight && set.reps > top.reps) ? set : top, sets[0]);
    const displayIncrease = weightUnit === "lb" ? 5 : exercise.equipment === "Dumbbells" ? 1 : 2.5;
    const increase = storedWeight(displayIncrease);
    return best.reps >= 10 ? `Try ${formatWeight(best.weight + increase)} for ${Math.max(6, best.reps - 2)}–${best.reps} reps` : `Match ${formatWeight(best.weight)} × ${best.reps}, then add a rep if form stays clean`;
}

function plateResult(total, bar) {
    const plates = weightUnit === "lb" ? [45, 35, 25, 10, 5, 2.5] : [25, 20, 15, 10, 5, 2.5, 1.25];
    let remaining = Math.max(0, (total - bar) / 2);
    const loaded = [];
    plates.forEach((plate) => {
        const count = Math.floor((remaining + 0.0001) / plate);
        if (count) { loaded.push(`${plate} × ${count}`); remaining -= plate * count; }
    });
    return total < bar ? `Target must be at least the ${bar} ${weightUnit} bar.` : `${loaded.length ? loaded.join(" + ") : "No plates"} per side${remaining > 0.01 ? ` · ${remaining.toFixed(2)} ${weightUnit} remaining` : ""}`;
}

function swapExerciseOnce(exerciseId, replacementId) {
    const scheduled = workoutForDate(viewedDate);
    const exerciseIds = scheduled.exerciseIds.map((id) => id === exerciseId ? replacementId : id);
    state.exerciseRules.push({ type: "once", date: dateKey(viewedDate), dayId: scheduled.id, exerciseIds });
    localStorage.removeItem(DRAFT_PREFIX + dateKey(viewedDate));
    saveState();
    renderWorkout();
    statusMessage.textContent = `${catalogById.get(exerciseId)?.name || "Exercise"} swapped for ${catalogById.get(replacementId)?.name || "replacement"} in this workout only.`;
}

function updateSetPBs(card, exerciseId, referenceDate = viewedDate) {
    const priorSessions = sessionsForExercise(exerciseId).filter((session) => session.date < dateKey(referenceDate));
    const priorWeight = priorSessions.length ? Math.max(...priorSessions.map((session) => session.maxWeight)) : 0;
    const priorOneRM = priorSessions.length ? Math.max(...priorSessions.map((session) => session.estimated1RM)) : 0;
    card.querySelectorAll(".set-row").forEach((row) => {
        const weight = storedWeight(row.querySelector(".weight-input").value) || 0;
        const reps = Number(row.querySelector(".reps-input").value) || 0;
        const isPB = priorSessions.length > 0 && weight > 0 && reps > 0 && (weight > priorWeight || estimatedOneRepMax(weight, reps) > priorOneRM + 0.05);
        row.classList.toggle("set-pb", isPB);
        row.dataset.pb = isPB ? "New PB" : "";
    });
}

function createExerciseCard(exercise, savedExercise = {}, referenceDate = viewedDate) {
    const previous = previousPerformanceForExercise(exercise.id, referenceDate);
    const previousSets = previous
        ? previous.exercise.sets.filter((set) => set.weight > 0 && set.reps > 0).map((set) => `${formatWeight(set.weight)} × ${set.reps}`).join(" · ")
        : "No previous session";
    const card = document.createElement("article");
    card.className = `exercise-card${savedExercise.completed ? " completed" : ""}`;
    card.dataset.exerciseId = exercise.id;
    const muscleColours = { Chest: "#ff7568", Back: "#62a8ff", Shoulders: "#ad83ff", Biceps: "#ffad55", Triceps: "#ff8d5f", Quads: "#72e586", Hamstrings: "#55cfa5", Glutes: "#e77fd1", Calves: "#91d66f", Core: "#f0c95e", Abs: "#f0c95e" };
    card.style.setProperty("--muscle-accent", muscleColours[canonicalMuscle(exercise.primaryMuscle)] || "var(--accent)");
    const notes = loadJSON(EXERCISE_NOTES_KEY, {});
    const alternatives = allExercises().filter((item) => item.id !== exercise.id && canonicalMuscle(item.primaryMuscle) === canonicalMuscle(exercise.primaryMuscle)).sort((a, b) => (a.equipment === exercise.equipment ? -1 : 1) - (b.equipment === exercise.equipment ? -1 : 1) || a.name.localeCompare(b.name));
    const restSeconds = exerciseRestSeconds(exercise);
    const targetWeight = previous?.exercise?.sets?.filter((set) => set.weight > 0).reduce((best, set) => Math.max(best, set.weight), 0) || 0;
    card.innerHTML = `
        <header class="exercise-header">
            <div><h3>${escapeHTML(exercise.name)}</h3><p class="equipment">${escapeHTML(exercise.equipment)}</p></div>
            <div class="exercise-header-actions"><button class="swap-exercise" type="button">Swap</button><label class="complete-label" title="Mark ${exercise.name} complete">
                <input class="exercise-complete" type="checkbox" ${savedExercise.completed ? "checked" : ""}>
                <span aria-hidden="true"></span>
            </label></div>
        </header>
        <div class="swap-panel" hidden><label>Similar exercise<select>${alternatives.map((item) => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.name)} · ${escapeHTML(item.equipment)}</option>`).join("")}</select></label><button type="button">Swap this workout</button></div>
        <div class="previous-performance">
            <div><span>Previous${previous ? ` · ${formatShortDate(previous.date)}` : ""}</span><strong>${previousSets}</strong></div>
            <div class="performance-target"><span>Today’s target</span><strong>${suggestedTarget(exercise, previous)}</strong></div>
        </div>
        <div class="sets-list"></div>
        <div class="exercise-card-tools"><button class="add-set" type="button">+ Add set</button>${savedAppearance.showExerciseRest === true ? `<button class="exercise-rest-suggestion" type="button" data-seconds="${restSeconds}">Suggested rest ${Math.floor(restSeconds / 60)}:${String(restSeconds % 60).padStart(2, "0")}</button>` : ""}</div>
        ${exercise.equipment === "Barbell" ? `<details class="plate-calculator"><summary>Plate calculator</summary><div><label>Total weight (${weightUnit})<input class="plate-total" type="number" min="0" step="0.5" value="${targetWeight ? Number(displayWeight(targetWeight).toFixed(2)) : ""}"></label><label>Bar (${weightUnit})<input class="plate-bar" type="number" min="0" step="0.5" value="${weightUnit === "lb" ? 45 : 20}"></label><p class="plate-result">Enter a target weight.</p></div></details>` : ""}
        <details class="exercise-notes"><summary>Exercise notes</summary><textarea maxlength="500" placeholder="Setup, form cues, seat position…">${escapeHTML(notes[exercise.id] || savedExercise.note || "")}</textarea></details>
    `;

    const setsContainer = card.querySelector(".sets-list");
    const savedSets = savedExercise.sets?.length ? savedExercise.sets : [{}, {}, {}];
    savedSets.forEach((set, index) => setsContainer.append(createSetRow(index + 1, set)));
    updateSetPBs(card, exercise.id, referenceDate);
    setsContainer.addEventListener("input", () => updateSetPBs(card, exercise.id, referenceDate));
    card.querySelector(".add-set").addEventListener("click", () => {
        setsContainer.append(createSetRow(setsContainer.children.length + 1));
        saveDraft();
        updateSummary();
        updateSetPBs(card, exercise.id, referenceDate);
    });
    const swapPanel = card.querySelector(".swap-panel");
    card.querySelector(".swap-exercise").addEventListener("click", () => { swapPanel.hidden = !swapPanel.hidden; });
    const swapConfirm = swapPanel.querySelector("button");
    swapConfirm.disabled = !alternatives.length;
    swapConfirm.addEventListener("click", () => swapExerciseOnce(exercise.id, swapPanel.querySelector("select").value));
    card.querySelector(".exercise-rest-suggestion")?.addEventListener("click", (event) => {
        resetTimer(Number(event.currentTarget.dataset.seconds));
        toggleTimer();
        document.querySelector("#rest-timer").hidden = false;
        document.body.classList.add("rest-timer-enabled");
    });
    const updatePlates = () => {
        const total = Number(card.querySelector(".plate-total")?.value);
        const bar = Number(card.querySelector(".plate-bar")?.value);
        const result = card.querySelector(".plate-result");
        if (result) result.textContent = total > 0 && bar > 0 ? plateResult(total, bar) : "Enter a target weight.";
    };
    card.querySelectorAll(".plate-calculator input").forEach((input) => input.addEventListener("input", updatePlates));
    updatePlates();
    const noteInput = card.querySelector(".exercise-notes textarea");
    noteInput.addEventListener("input", () => {
        const savedNotes = loadJSON(EXERCISE_NOTES_KEY, {});
        if (noteInput.value.trim()) savedNotes[exercise.id] = noteInput.value;
        else delete savedNotes[exercise.id];
        localStorage.setItem(EXERCISE_NOTES_KEY, JSON.stringify(savedNotes));
        saveDraft();
        queueAutosave();
    });
    card.querySelector(".exercise-complete").addEventListener("change", (event) => {
        card.classList.toggle("completed", event.target.checked);
        if (event.target.checked) {
            card.classList.remove("just-completed");
            (window.requestAnimationFrame || ((callback) => setTimeout(callback, 0)))(() => card.classList.add("just-completed"));
            setTimeout(() => card.classList.remove("just-completed"), 600);
            if (navigator.vibrate) navigator.vibrate(12);
        }
        saveDraft();
        updateSummary();
    });
    return card;
}

function previousPerformanceForExercise(exerciseId, referenceDate) {
    return [...completedWorkouts()].reverse().flatMap((workout) => {
        if (workout.date >= dateKey(referenceDate)) return [];
        const exercise = workout.exercises.find((item) => item.id === exerciseId);
        return exercise ? [{ date: workout.date, exercise }] : [];
    })[0] || null;
}

function diagramRegionsForMuscle(muscle) {
    const mappings = {
        "Upper Chest": ["Chest"], Chest: ["Chest"],
        Shoulders: ["Shoulders"], "Front Delts": ["Shoulders"], "Side Delts": ["Shoulders"],
        "Rear Delts": ["Rear Delts"], Traps: ["Traps"],
        Back: ["Lats", "Traps", "Lower Back"], "Upper Back": ["Lats", "Traps"], Lats: ["Lats"],
        Biceps: ["Biceps"], Triceps: ["Triceps"], Forearms: ["Forearms"],
        Abs: ["Abs"], Core: ["Abs", "Obliques"], Obliques: ["Obliques"],
        Quads: ["Quads"], Adductors: ["Quads"], Hamstrings: ["Hamstrings"],
        Glutes: ["Glutes"], Calves: ["Calves"], "Lower Back": ["Lower Back"],
        "Hip Flexors": ["Quads"], "Full Body": ["Shoulders", "Chest", "Lats", "Abs", "Quads", "Hamstrings", "Glutes"]
    };
    return mappings[muscle] || [];
}

function renderMuscleCoverage(exercises) {
    const primaryCounts = new Map();
    const secondaryCounts = new Map();
    exercises.forEach((exercise) => {
        primaryCounts.set(exercise.primaryMuscle, (primaryCounts.get(exercise.primaryMuscle) || 0) + 1);
        exercise.secondaryMuscles.forEach((muscle) => {
            secondaryCounts.set(muscle, (secondaryCounts.get(muscle) || 0) + 1);
        });
    });
    const primary = [...primaryCounts].sort((a, b) => b[1] - a[1]);
    const secondary = [...secondaryCounts].filter(([muscle]) => !primaryCounts.has(muscle)).sort((a, b) => b[1] - a[1]);
    const chips = (items) => items.length
        ? items.map(([muscle, count]) => `<span class="muscle-chip">${escapeHTML(muscle)}${count > 1 ? ` ×${count}` : ""}</span>`).join("")
        : '<span class="muscle-chip">None</span>';
    document.querySelector("#primary-muscles").innerHTML = chips(primary);
    document.querySelector("#secondary-muscles").innerHTML = chips(secondary);

    const primaryRegions = new Set(primary.flatMap(([muscle]) => diagramRegionsForMuscle(muscle)));
    const secondaryRegions = new Set(secondary.flatMap(([muscle]) => diagramRegionsForMuscle(muscle)));
    document.querySelectorAll(".muscle-zone").forEach((zone) => {
        const region = zone.dataset.muscle;
        zone.classList.toggle("primary-hit", primaryRegions.has(region));
        zone.classList.toggle("secondary-hit", !primaryRegions.has(region) && secondaryRegions.has(region));
    });
}

function readWorkoutFromPage() {
    const scheduled = workoutForDate(viewedDate);
    return {
        date: dateKey(viewedDate),
        split: scheduled.name,
        splitIndex: scheduled.index,
        sessionDurationSeconds: getSessionElapsedSeconds(),
        exercises: scheduled.exercises.map((exercise) => {
            const card = document.querySelector(`[data-exercise-id="${exercise.id}"]`);
            return {
                ...exercise,
                completed: card.querySelector(".exercise-complete").checked,
                note: card.querySelector(".exercise-notes textarea")?.value || "",
                sets: [...card.querySelectorAll(".set-row")].map((row) => ({
                    weight: storedWeight(row.querySelector(".weight-input").value) || 0,
                    reps: Number(row.querySelector(".reps-input").value) || 0
                }))
            };
        })
    };
}

function saveDraft() {
    const scheduled = workoutForDate(viewedDate);
    if (scheduled && !scheduled.isRest && exerciseList.children.length) {
        localStorage.setItem(DRAFT_PREFIX + dateKey(viewedDate), JSON.stringify(readWorkoutFromPage()));
        queueAutosave();
    }
}

function updateSummary() {
    const scheduled = workoutForDate(viewedDate);
    if (!scheduled || scheduled.isRest || !exerciseList.children.length) return;
    const workout = readWorkoutFromPage();
    const completed = workout.exercises.filter((exercise) => exercise.completed).length;
    const loggedSets = workout.exercises.flatMap((exercise) => exercise.sets)
        .filter((set) => set.weight > 0 && set.reps > 0);
    const volume = loggedSets.reduce((total, set) => total + set.weight * set.reps, 0);
    document.querySelector("#completed-count").textContent = `${completed}/${scheduled.exercises.length}`;
    document.querySelector("#set-count").textContent = loggedSets.length;
    document.querySelector("#total-volume").textContent = formatVolume(volume);
    const percentage = scheduled.exercises.length ? Math.round(completed / scheduled.exercises.length * 100) : 0;
    const ring = document.querySelector("#hero-progress-ring");
    ring.style.setProperty("--progress", `${percentage * 3.6}deg`);
    ring.setAttribute("aria-valuenow", percentage);
    document.querySelector("#hero-progress-percent").textContent = `${percentage}%`;
    document.querySelector("#workout-hero").classList.toggle("all-complete", percentage === 100);
}

function viewWorkoutDate(date) {
    viewedDate = startOfDay(date);
    renderWorkout();
}

function renderUpcoming() {
    const container = document.querySelector("#upcoming-days");
    container.innerHTML = "";
    const rangeStart = addDays(today, miniCalendarOffset);
    const rangeEnd = addDays(rangeStart, 3);
    document.querySelector("#mini-calendar-range").textContent = miniCalendarOffset === 0 ? "Current rotation" : `${formatShortDate(dateKey(rangeStart))} – ${new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short" }).format(rangeEnd)}`;
    for (let offset = 0; offset < 4; offset += 1) {
        const date = addDays(today, miniCalendarOffset + offset);
        const scheduled = workoutForDate(date);
        const dayHistory = history[dateKey(date)];
        const card = document.createElement("button");
        card.type = "button";
        const kind = scheduled.isRest ? "rest" : ["push", "pull", "legs"].find((name) => scheduled.id?.toLowerCase().includes(name) || scheduled.name.toLowerCase().includes(name)) || "custom";
        const miniColours = { push: "#ff765f", pull: "#62a8ff", legs: "#72e586", rest: "#b58cff" };
        const customColours = ["#ffb454", "#4fd1c5", "#e77fd1", "#f0c95e", "#8ea2ff", "#ff8f70", "#66d49a", "#c794ff"];
        card.style.setProperty("--day-colour", miniColours[kind] || customColours[scheduled.index % customColours.length]);
        const isToday = dateKey(date) === dateKey(today);
        card.className = `upcoming-day split-kind-${kind}${isToday ? " today" : ""}${dateKey(date) === dateKey(viewedDate) ? " selected" : ""}`;
        const displayName = dayHistory?.status === "missed" ? `Missed · ${scheduled.name}` : scheduled.name;
        card.innerHTML = `<span>${isToday ? "Today" : new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric" }).format(date)}</span><strong>${escapeHTML(displayName)}</strong>`;
        card.addEventListener("click", () => viewWorkoutDate(date));
        container.append(card);
    }
}

document.querySelector("#mini-calendar-previous").addEventListener("click", () => { miniCalendarOffset -= Math.max(1, state.split.length); renderUpcoming(); });
document.querySelector("#mini-calendar-next").addEventListener("click", () => { miniCalendarOffset += Math.max(1, state.split.length); renderUpcoming(); });

function renderWorkout() {
    const scheduled = workoutForDate(viewedDate);
    const key = dateKey(viewedDate);
    const historicalWorkout = history[key]?.status === "complete" ? history[key] : null;
    const savedDraft = historicalWorkout || loadJSON(DRAFT_PREFIX + key, null);
    const isToday = key === dateKey(today);
    const isFuture = viewedDate > today;
    exerciseList.innerHTML = "";
    statusMessage.textContent = "";
    document.querySelector("#workout-date-label").textContent = isToday ? "Today's workout" : isFuture ? "Planned workout" : "Past workout";
    document.querySelector("#workout-title").textContent = `${scheduled.name} Day`;
    document.querySelector("#rotation-position").textContent = `Day ${scheduled.index + 1} of ${state.split.length}`;
    document.querySelector("#workout-date").textContent = new Intl.DateTimeFormat("en-AU", {
        weekday: "short", day: "numeric", month: "short"
    }).format(viewedDate);
    document.querySelector("#return-today").hidden = isToday;

    const isRest = scheduled.isRest;
    document.querySelector("#workout-hero").classList.toggle("rest-hero", isRest);
    workoutForm.hidden = isRest;
    document.querySelector("#workout-summary").hidden = isRest;
    document.querySelector("#muscle-coverage").hidden = isRest;
    document.querySelector("#rest-timer").hidden = isRest;
    document.querySelector("#session-timer").hidden = isRest;
    document.querySelector("#rest-panel").hidden = !isRest;
    document.querySelector("#skip-rest-day").hidden = !isRest || !isToday;
    if (!isRest) {
        const focus = [...new Set(scheduled.exercises.map((exercise) => canonicalMuscle(exercise.primaryMuscle)))];
        document.querySelector("#hero-muscle-focus").textContent = focus.slice(0, 3).join(" · ") || "Mixed";
        const previousSplit = completedWorkouts().filter((workout) => workout.date < key && workout.split === scheduled.name).at(-1);
        document.querySelector("#hero-previous-session").textContent = previousSplit
            ? `${formatShortDate(previousSplit.date)} · ${formatVolume(workoutVolume(previousSplit))}`
            : "No previous session";
        document.querySelector("#hero-workout-plan").textContent = `${scheduled.exercises.length} exercises · ~${Math.max(20, scheduled.exercises.length * 7)} min`;
        scheduled.exercises.forEach((exercise) => {
            const savedExercise = savedDraft?.exercises?.find((item) => item.id === exercise.id);
            exerciseList.append(createExerciseCard(exercise, savedExercise, viewedDate));
        });
        renderMuscleCoverage(scheduled.exercises);
        updateSummary();
        document.querySelector("#workout-actions").hidden = isFuture;
        document.querySelector("#edit-exercises").hidden = isFuture;
        document.querySelector("#copy-last-values").hidden = isFuture;
        if (isFuture) {
            exerciseList.querySelectorAll("input, button").forEach((control) => { control.disabled = true; });
            statusMessage.textContent = "Future workout preview. Return on this date to log sets.";
        } else {
            document.querySelector(".complete-workout").textContent = isToday ? "Complete Workout" : "Save Past Workout";
            document.querySelector("#miss-workout").textContent = isToday ? "Missed — Push Split" : "Mark Missed — Push Split";
        }
    }
    renderWorkoutGoalAttempts(scheduled, isToday, isRest);
    renderUpcoming();
    renderSplitList();
    updateToolVisibility();
}

function copyLastWorkoutValues() {
    const scheduled = workoutForDate(viewedDate);
    let copied = 0;
    scheduled.exercises.forEach((exercise) => {
        const previous = previousPerformanceForExercise(exercise.id, viewedDate);
        const sets = previous?.exercise?.sets?.filter((set) => set.weight > 0 && set.reps > 0) || [];
        const card = [...document.querySelectorAll(".exercise-card[data-exercise-id]")].find((item) => item.dataset.exerciseId === exercise.id);
        if (!sets.length || !card) return;
        const container = card.querySelector(".sets-list");
        container.innerHTML = "";
        sets.forEach((set, index) => container.append(createSetRow(index + 1, set)));
        updateSetPBs(card, exercise.id, viewedDate);
        copied += 1;
    });
    if (copied) {
        saveDraft();
        updateSummary();
        statusMessage.textContent = `Copied previous set values for ${copied} exercise${copied === 1 ? "" : "s"}.`;
    } else statusMessage.textContent = "No previous workout values are available to copy yet.";
}

document.querySelector("#copy-last-values").addEventListener("click", copyLastWorkoutValues);

function renderSplitList() {
    const currentIndex = scheduleIndexFor(viewedDate);
    document.querySelector("#split-name-label").textContent = state.splitName;
    const list = document.querySelector("#split-list");
    list.innerHTML = "";
    state.split.forEach((day, index) => {
        const item = document.createElement("li");
        item.textContent = `${index + 1}. ${day.name}`;
        if (index === currentIndex) item.className = "current";
        list.append(item);
    });
}

function statusForDate(date, scheduled) {
    const key = dateKey(date);
    const entry = history[key];
    if (scheduled.isRest) return { className: "rest", symbol: "☾" };
    if (entry?.status === "complete") return { className: "complete", symbol: "✓" };
    if (entry?.status === "missed") return { className: "missed", symbol: "×" };
    if (date < dateFromKey(state.trackingStartDate)) return { className: "planned", symbol: "" };
    if (date < today) return { className: "missed", symbol: "×" };
    return { className: "planned", symbol: "" };
}

function renderCalendar() {
    document.querySelector("#calendar-streak-count").textContent = calculateStreaks().current;
    document.querySelector("#calendar-month").textContent = new Intl.DateTimeFormat("en-AU", {
        month: "long", year: "numeric"
    }).format(calendarCursor);
    const grid = document.querySelector("#calendar-grid");
    grid.innerHTML = "";

    const first = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const gridStart = addDays(first, -mondayOffset);
    for (let index = 0; index < 42; index += 1) {
        const date = addDays(gridStart, index);
        const scheduled = workoutForDate(date);
        const cell = document.createElement("button");
        cell.type = "button";
        const outside = date.getMonth() !== calendarCursor.getMonth();
        const isToday = dateKey(date) === dateKey(today);
        const isSelected = dateKey(date) === dateKey(calendarSelectedDate);
        cell.className = `calendar-day${outside ? " outside" : ""}${isToday ? " today" : ""}${isSelected ? " selected" : ""}`;

        if (!scheduled) {
            cell.innerHTML = `<span class="day-number">${date.getDate()}</span>`;
        } else {
            const status = statusForDate(date, scheduled);
            cell.classList.add(`status-${status.className}`);
            const displayName = history[dateKey(date)]?.status === "missed" ? `Missed · ${scheduled.name}` : scheduled.name;
            cell.innerHTML = `
                <span class="day-number">${date.getDate()}</span>
                <span class="day-workout">${escapeHTML(displayName)}</span>
                <span class="day-status ${status.className}">${status.symbol}</span>
            `;
        }
        cell.addEventListener("click", () => {
            calendarSelectedDate = date;
            renderCalendar();
        });
        grid.append(cell);
    }
    renderCalendarDayDetail(calendarSelectedDate);
    renderRecapLibrary();
}

function renderCalendarDayDetail(date) {
    const scheduled = workoutForDate(date);
    const entry = history[dateKey(date)];
    if (!scheduled) {
        document.querySelector("#calendar-day-detail").hidden = true;
        return;
    }
    const status = statusForDate(date, scheduled);
    const labels = { complete: "Completed", missed: "Missed", rest: "Recovery", planned: date > today ? "Upcoming" : "Planned" };
    const colour = status.className === "complete" ? "#72e586" : status.className === "missed" ? "#ff765f" : status.className === "rest" ? "#8290b6" : "var(--accent)";
    const detail = document.querySelector("#calendar-day-detail");
    detail.hidden = false;
    detail.style.setProperty("--split-color", colour);
    detail.dataset.status = status.className;
    document.querySelector("#calendar-detail-status").textContent = labels[status.className];
    document.querySelector("#calendar-detail-title").textContent = `${scheduled.name} Day`;
    document.querySelector("#calendar-detail-date").textContent = new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
    const stats = document.querySelector("#calendar-detail-stats");
    const exercises = document.querySelector("#calendar-detail-exercises");
    if (entry?.status === "complete" && Array.isArray(entry.exercises)) {
        const validSets = entry.exercises.flatMap((exercise) => exercise.sets || []).filter((set) => set.weight > 0 && set.reps > 0);
        const completed = entry.exercises.filter((exercise) => exercise.completed).length;
        stats.innerHTML = `<div><strong>${completed}/${entry.exercises.length}</strong><span>Exercises</span></div><div><strong>${validSets.length}</strong><span>Sets</span></div><div><strong>${formatVolume(workoutVolume(entry))}</strong><span>Volume</span></div>${entry.sessionDurationSeconds ? `<div><strong>${formatSessionTime(entry.sessionDurationSeconds)}</strong><span>Duration</span></div>` : ""}`;
        exercises.innerHTML = entry.exercises.map((exercise) => `<span>${escapeHTML(exercise.name)}</span>`).join("");
        document.querySelector("#calendar-view-workout").textContent = "View logged workout";
    } else if (scheduled.isRest) {
        stats.innerHTML = '<p>Recovery is part of the rotation. Skip it from the Workout page if you feel ready to train.</p>';
        exercises.innerHTML = "";
        document.querySelector("#calendar-view-workout").textContent = "View rest day";
    } else {
        stats.innerHTML = `<div><strong>${scheduled.exercises.length}</strong><span>Exercises planned</span></div><div><strong>${[...new Set(scheduled.exercises.map((exercise) => canonicalMuscle(exercise.primaryMuscle)))].length}</strong><span>Muscle groups</span></div>`;
        exercises.innerHTML = scheduled.exercises.map((exercise) => `<span>${escapeHTML(exercise.name)}</span>`).join("");
        document.querySelector("#calendar-view-workout").textContent = date > today ? "Preview workout" : "Open workout";
    }
}

function recapPeriod(type, endDate = today) {
    const end = startOfDay(endDate);
    if (type === "weekly") return { start: startOfWeek(end), end };
    let start = end;
    for (let offset = 1; offset <= Math.max(state.split.length * 2, 14); offset += 1) {
        const candidate = addDays(end, -offset);
        if (workoutForDate(candidate)?.isRest) break;
        start = candidate;
    }
    return { start, end };
}

function recapGoalSnapshots(endKey) {
    return loadJSON(GOALS_KEY, []).map((goal) => {
        const sessions = sessionsForExercise(goal.exerciseId).filter((session) => session.date <= endKey);
        const current = sessions.length ? Math.max(...sessions.map((session) => session.estimated1RM)) : 0;
        const target = estimatedOneRepMax(goal.weight, goal.reps);
        return {
            exerciseId: goal.exerciseId,
            name: catalogById.get(goal.exerciseId)?.name || goal.exerciseId,
            targetWeight: goal.weight,
            reps: goal.reps,
            current,
            target,
            progress: target > 0 ? Math.min(100, current / target * 100) : 0,
            ready: current >= target * 0.98
        };
    });
}

function buildRecap(type, endDate = today) {
    const { start, end } = recapPeriod(type, endDate);
    const startKey = dateKey(start);
    const endKey = dateKey(end);
    const workouts = workoutsInRange(start, end);
    const sets = workouts.flatMap((workout) => workout.exercises.flatMap((exercise) => exercise.sets || []).filter((set) => set.weight > 0 && set.reps > 0));
    const exerciseIds = [...new Set(workouts.flatMap((workout) => workout.exercises.map((exercise) => exercise.id)))];
    const prs = exerciseIds.flatMap((exerciseId) => {
        const current = sessionsForExercise(exerciseId).filter((session) => session.date >= startKey && session.date <= endKey);
        const previous = sessionsForExercise(exerciseId).filter((session) => session.date < startKey);
        if (!current.length || !previous.length) return [];
        const currentBest = Math.max(...current.map((session) => session.estimated1RM));
        const previousBest = Math.max(...previous.map((session) => session.estimated1RM));
        return currentBest > previousBest + 0.05 ? [{ name: catalogById.get(exerciseId)?.name || exerciseId, value: currentBest, gain: currentBest - previousBest }] : [];
    }).sort((a, b) => b.gain - a.gain);
    return {
        id: `${type}-${endKey}`,
        type,
        createdAt: new Date().toISOString(),
        start: startKey,
        end: endKey,
        workouts: workouts.length,
        sets: sets.length,
        volume: workouts.reduce((sum, workout) => sum + workoutVolume(workout), 0),
        durationSeconds: workouts.reduce((sum, workout) => sum + (workout.sessionDurationSeconds || 0), 0),
        prs,
        goals: recapGoalSnapshots(endKey)
    };
}

function saveRecap(recap) {
    const recaps = loadJSON(RECAPS_KEY, []).filter((saved) => saved.id !== recap.id);
    recaps.push(recap);
    recaps.sort((a, b) => a.end.localeCompare(b.end));
    localStorage.setItem(RECAPS_KEY, JSON.stringify(recaps));
    queueAutosave();
    return recap;
}

function recapRangeLabel(recap) {
    return `${formatShortDate(recap.start)} – ${formatShortDate(recap.end)}`;
}

function renderRecapLibrary() {
    const recaps = loadJSON(RECAPS_KEY, []).sort((a, b) => b.end.localeCompare(a.end));
    document.querySelector("#recap-count").textContent = `${recaps.length} saved`;
    document.querySelector("#recap-library").innerHTML = recaps.length ? recaps.map((recap) => `
        <button type="button" data-recap-id="${escapeHTML(recap.id)}"><span><strong>${recap.type === "weekly" ? "Weekly recap" : "Split recap"}</strong><small>${recapRangeLabel(recap)}</small></span><span><strong>${recap.workouts}</strong><small>workouts</small></span><span><strong>${recap.prs.length}</strong><small>PRs</small></span><b aria-hidden="true">›</b></button>`).join("") : '<p class="empty-history">Your first recap will appear after a week or at the end of your split.</p>';
    document.querySelectorAll("#recap-library [data-recap-id]").forEach((button) => button.addEventListener("click", () => showRecap(recaps.find((recap) => recap.id === button.dataset.recapId))));
}

function renderRecapComparison(current, previous) {
    const metrics = [
        ["Workouts", current.workouts, previous.workouts, ""],
        ["Logged sets", current.sets, previous.sets, ""],
        ["Volume", current.volume, previous.volume, ` ${weightUnit}`],
        ["PRs", current.prs.length, previous.prs.length, ""]
    ];
    document.querySelector("#recap-comparison-results").innerHTML = metrics.map(([label, value, oldValue, unit]) => {
        const shownValue = label === "Volume" ? Math.round(displayWeight(value)).toLocaleString() : value;
        const shownOld = label === "Volume" ? Math.round(displayWeight(oldValue)).toLocaleString() : oldValue;
        const delta = value - oldValue;
        return `<article><span>${label}</span><strong>${shownValue}${unit}</strong><small>vs ${shownOld}${unit} · ${delta > 0 ? "+" : ""}${label === "Volume" ? Math.round(displayWeight(delta)).toLocaleString() : delta}</small></article>`;
    }).join("");
}

function showRecap(recap) {
    if (!recap) return;
    const dialog = document.querySelector("#recap-dialog");
    dialog.dataset.recapId = recap.id;
    document.querySelector("#recap-kicker").textContent = recap.type === "weekly" ? "Weekly recap" : "Split recap";
    document.querySelector("#recap-title").textContent = recap.workouts ? "Training worth celebrating" : "A quieter training period";
    document.querySelector("#recap-range").textContent = recapRangeLabel(recap);
    document.querySelector("#recap-summary").innerHTML = `<div><strong>${recap.workouts}</strong><span>Workouts</span></div><div><strong>${recap.sets}</strong><span>Logged sets</span></div><div><strong>${formatVolume(recap.volume)}</strong><span>Volume</span></div><div><strong>${recap.prs.length}</strong><span>Strength PRs</span></div>`;
    document.querySelector("#recap-highlights").innerHTML = recap.prs.length ? recap.prs.slice(0, 4).map((pr) => `<article><span>↑</span><div><strong>${escapeHTML(pr.name)}</strong><small>${formatWeight(pr.value)} estimated 1RM · +${formatWeight(pr.gain)}</small></div></article>`).join("") : '<p class="empty-history">No new estimated 1RM records in this recap. Consistent sessions still count.</p>';
    document.querySelector("#recap-goals").innerHTML = recap.goals.length ? recap.goals.map((goal) => `<article class="${goal.ready ? "ready" : ""}"><div><strong>${escapeHTML(goal.name)}</strong><span>${goal.progress.toFixed(0)}%${goal.ready ? " · Ready to attempt" : ""}</span></div><i><b style="width:${goal.progress}%"></b></i><small>${formatWeight(goal.current)} estimated / ${formatWeight(goal.target)} target</small></article>`).join("") : '<p class="empty-history">No strength goals were active. Add one in Progress to include it in future recaps.</p>';
    const previous = loadJSON(RECAPS_KEY, []).filter((saved) => saved.id !== recap.id && saved.type === recap.type && saved.end < recap.end).sort((a, b) => b.end.localeCompare(a.end));
    const compareButton = document.querySelector("#open-recap-compare");
    compareButton.hidden = !previous.length;
    document.querySelector("#recap-compare").hidden = true;
    const select = document.querySelector("#recap-compare-select");
    select.innerHTML = previous.map((saved) => `<option value="${escapeHTML(saved.id)}">${recapRangeLabel(saved)}</option>`).join("");
    if (previous.length) renderRecapComparison(recap, previous[0]);
    if (!dialog.open) dialog.showModal();
}

function createDueRecap(showPopup = false) {
    const timing = savedAppearance.recapTiming === "split" ? "split-rest" : savedAppearance.recapTiming || "weekly";
    let dueDate = timing === "weekly" ? (today.getDay() === 0 ? today : addDays(today, -today.getDay())) : null;
    if (timing === "split-rest") {
        for (let offset = 0; offset <= Math.max(state.split.length, 7); offset += 1) {
            const candidate = addDays(today, -offset);
            if (workoutForDate(candidate)?.isRest) { dueDate = candidate; break; }
        }
    }
    if (timing === "split-end") {
        for (let offset = 0; offset <= Math.max(state.split.length, 7); offset += 1) {
            const candidate = addDays(today, -offset);
            if (!workoutForDate(candidate)?.isRest && workoutForDate(addDays(candidate, 1))?.isRest) { dueDate = candidate; break; }
        }
    }
    if (!dueDate || dueDate < dateFromKey(state.trackingStartDate)) return;
    const recapId = `${timing}-${dateKey(dueDate)}`;
    const existing = loadJSON(RECAPS_KEY, []).find((saved) => saved.id === recapId);
    const recap = existing && dateKey(dueDate) !== dateKey(today) ? existing : saveRecap(buildRecap(timing, dueDate));
    renderRecapLibrary();
    const shown = loadJSON(RECAP_SHOWN_KEY, []);
    if (showPopup && savedAppearance.showRecapPopup && !shown.includes(recap.id)) {
        localStorage.setItem(RECAP_SHOWN_KEY, JSON.stringify([...shown, recap.id]));
        showRecap(recap);
    }
}

document.querySelector("#calendar-view-workout").addEventListener("click", () => {
    viewWorkoutDate(calendarSelectedDate);
    showView("workout-view");
});
document.querySelector("#close-recap").addEventListener("click", () => document.querySelector("#recap-dialog").close());
document.querySelector("#close-goal-achieved").addEventListener("click", () => {
    document.querySelector("#goal-achieved-dialog").close();
    document.body.classList.remove("goal-achievement-flash");
});
document.querySelector("#open-recap-compare").addEventListener("click", () => { document.querySelector("#recap-compare").hidden = false; });
document.querySelector("#recap-compare-select").addEventListener("change", (event) => {
    const recaps = loadJSON(RECAPS_KEY, []);
    const current = recaps.find((recap) => recap.id === document.querySelector("#recap-dialog").dataset.recapId);
    const previous = recaps.find((recap) => recap.id === event.target.value);
    if (current && previous) renderRecapComparison(current, previous);
});

function completedWorkouts() {
    return Object.values(history)
        .filter((workout) => workout.status === "complete" && Array.isArray(workout.exercises))
        .sort((a, b) => a.date.localeCompare(b.date));
}

function estimatedOneRepMax(weight, reps) {
    if (weight <= 0 || reps <= 0 || reps > 15) return 0;
    return reps === 1 ? weight : weight * (1 + reps / 30);
}

function sessionsForExercise(exerciseId) {
    return completedWorkouts().flatMap((workout) => {
        const exercise = workout.exercises.find((item) => item.id === exerciseId);
        if (!exercise) return [];
        const sets = exercise.sets.filter((set) => set.weight > 0 && set.reps > 0);
        if (!sets.length) return [];
        return [{
            date: workout.date,
            split: workout.split,
            sets,
            maxWeight: Math.max(...sets.map((set) => set.weight)),
            maxReps: Math.max(...sets.map((set) => set.reps)),
            volume: sets.reduce((sum, set) => sum + set.weight * set.reps, 0),
            bestSetVolume: Math.max(...sets.map((set) => set.weight * set.reps)),
            estimated1RM: Math.max(...sets.map((set) => estimatedOneRepMax(set.weight, set.reps)))
        }];
    });
}

function formatShortDate(key) {
    return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }).format(dateFromKey(key));
}

function populateProgressExercises() {
    const select = document.querySelector("#progress-exercise");
    const previous = select.value;
    const historyIds = new Set(completedWorkouts().flatMap((workout) => workout.exercises.map((exercise) => exercise.id)));
    const activeIds = new Set(state.split.flatMap((day) => day.exerciseIds));
    const ids = [...new Set([...historyIds, ...activeIds])].filter((id) => catalogById.has(id));
    ids.sort((a, b) => {
        if (historyIds.has(a) !== historyIds.has(b)) return historyIds.has(a) ? -1 : 1;
        return catalogById.get(a).name.localeCompare(catalogById.get(b).name);
    });
    select.innerHTML = ids.map((id) => `<option value="${escapeHTML(id)}">${escapeHTML(catalogById.get(id).name)}</option>`).join("");
    if (ids.includes(previous)) select.value = previous;
}

function bestRecord(sessions, property) {
    return sessions.filter((session) => session[property] > 0).reduce((best, session) => (
        !best || session[property] > best[property] ? session : best
    ), null);
}

function setRecord(valueId, dateId, record, property, kind = "weight") {
    const value = record?.[property];
    document.querySelector(`#${valueId}`).textContent = record ? (kind === "reps" ? `${value} reps` : formatWeight(value)) : "—";
    document.querySelector(`#${dateId}`).textContent = record ? formatShortDate(record.date) : "No data yet";
}

function renderRecords(sessions) {
    setRecord("record-one-rm", "record-one-rm-date", bestRecord(sessions, "estimated1RM"), "estimated1RM");
    setRecord("record-weight", "record-weight-date", bestRecord(sessions, "maxWeight"), "maxWeight");
    setRecord("record-set-volume", "record-set-volume-date", bestRecord(sessions, "bestSetVolume"), "bestSetVolume");
    setRecord("record-reps", "record-reps-date", bestRecord(sessions, "maxReps"), "maxReps", "reps");
}

const metricDetails = {
    estimated1RM: { label: "Estimated 1RM", unit: "kg" },
    maxWeight: { label: "Best weight", unit: "kg" },
    volume: { label: "Session volume", unit: "kg" },
    maxReps: { label: "Best set reps", unit: "reps" }
};

function renderProgressChart(sessions) {
    const mode = document.querySelector("#progress-graph-mode").value;
    const metric = mode === "combined" ? "estimated1RM" : document.querySelector("#progress-metric").value;
    const details = metricDetails[metric];
    const range = document.querySelector("#graph-range").value;
    const cutoff = range === "all" ? "0000-00-00" : dateKey(addDays(today, -(Number(range) - 1)));
    const strengthPoints = sessions.filter((session) => session[metric] > 0 && session.date >= cutoff).map((point) => ({ date: point.date, value: metric === "maxReps" ? point[metric] : displayWeight(point[metric]) }));
    const bodyPoints = loadJSON(BODYWEIGHT_KEY, []).filter((entry) => entry.weight > 0 && entry.date >= cutoff).sort((a, b) => a.date.localeCompare(b.date)).map((entry) => ({ date: entry.date, value: displayWeight(entry.weight) }));
    const series = mode === "strength" ? [{ name: details.label, points: strengthPoints, className: "strength-series" }]
        : mode === "bodyweight" ? [{ name: "Bodyweight", points: bodyPoints, className: "bodyweight-series" }]
            : [{ name: details.label, points: strengthPoints, className: "strength-series" }, { name: "Bodyweight", points: bodyPoints, className: "bodyweight-series" }].filter((item) => item.points.length);
    const allPoints = series.flatMap((item) => item.points);
    const svg = document.querySelector("#progress-chart");
    const empty = document.querySelector("#chart-empty");
    document.querySelector("#chart-title").textContent = mode === "combined" ? "Strength + bodyweight overview" : mode === "bodyweight" ? "Bodyweight" : details.label;
    empty.hidden = allPoints.length > 0;
    svg.hidden = allPoints.length === 0;
    if (!allPoints.length) {
        document.querySelector("#chart-change").textContent = "";
        svg.innerHTML = "";
        return;
    }

    const width = 700;
    const height = 300;
    const padding = { left: 58, right: 20, top: 22, bottom: 42 };
    const values = allPoints.map((point) => point.value);
    let minValue = Math.min(...values);
    let maxValue = Math.max(...values);
    if (minValue === maxValue) {
        minValue = Math.max(0, minValue * 0.9);
        maxValue = maxValue === 0 ? 1 : maxValue * 1.1;
    } else {
        const margin = (maxValue - minValue) * 0.15;
        minValue = Math.max(0, minValue - margin);
        maxValue += margin;
    }

    const dates = allPoints.map((point) => dateFromKey(point.date).getTime());
    const firstDate = range === "all"
        ? Math.min(...dates, dateFromKey(state.trackingStartDate).getTime())
        : dateFromKey(cutoff).getTime();
    const lastDate = today.getTime();
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const xFor = (point, index) => lastDate === firstDate
        ? padding.left + plotWidth / 2
        : padding.left + ((dateFromKey(point.date).getTime() - firstDate) / (lastDate - firstDate)) * plotWidth;
    const normalized = false;
    const coordinatesFor = (item) => {
        const itemValues = item.points.map((point) => point.value);
        const itemMin = Math.min(...itemValues);
        const itemMax = Math.max(...itemValues);
        return item.points.map((point, index) => {
            const ratio = normalized ? (itemMax === itemMin ? 0.5 : (point.value - itemMin) / (itemMax - itemMin)) : (point.value - minValue) / (maxValue - minValue);
            return { x: xFor(point, index), y: padding.top + (1 - ratio) * plotHeight, point };
        });
    };

    const gridLines = Array.from({ length: 5 }, (_, index) => {
        const fraction = index / 4;
        const y = padding.top + fraction * plotHeight;
        const value = maxValue - fraction * (maxValue - minValue);
        return `<line class="chart-grid-line" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"></line>
            <text class="chart-axis-label" x="${padding.left - 8}" y="${y + 3}" text-anchor="end">${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}${metric === "maxReps" ? "" : ` ${weightUnit}`}</text>`;
    }).join("");
    const phaseColours = { cut: "#ff765f", maintain: "#62a8ff", bulk: "#72e586" };
    const phaseRects = loadJSON(PHASES_KEY, []).map((phase) => {
        const start = Math.max(firstDate, dateFromKey(phase.start).getTime());
        const end = Math.min(lastDate, dateFromKey(phase.end).getTime());
        if (end < firstDate || start > lastDate) return "";
        const x1 = lastDate === firstDate ? padding.left : padding.left + (start - firstDate) / (lastDate - firstDate) * plotWidth;
        const x2 = lastDate === firstDate ? width - padding.right : padding.left + (end - firstDate) / (lastDate - firstDate) * plotWidth;
        return `<rect class="phase-band" x="${x1}" y="${padding.top}" width="${Math.max(3, x2 - x1)}" height="${plotHeight}" fill="${phaseColours[phase.type]}" opacity="0.09"><title>${phase.type}: ${phase.start} to ${phase.end}</title></rect>`;
    }).join("");
    const plottedSeries = series.map((item) => {
        const coordinates = coordinatesFor(item);
        const line = coordinates.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
        const circles = coordinates.map(({ x, y, point }) => `<circle class="chart-point ${item.className}" cx="${x}" cy="${y}" r="5"><title>${item.name} · ${formatShortDate(point.date)}: ${point.value.toFixed(1)} ${metric === "maxReps" && item.name !== "Bodyweight" ? "reps" : weightUnit}</title></circle>`).join("");
        return `<polyline class="chart-line ${item.className}" points="${line}"></polyline>${circles}`;
    }).join("");
    const labelDates = Array.from({ length: 5 }, (_, index) => firstDate + (lastDate - firstDate) * (index / 4));
    const dateLabels = labelDates.map((time) => `<text class="chart-axis-label" x="${lastDate === firstDate ? padding.left + plotWidth / 2 : padding.left + (time - firstDate) / (lastDate - firstDate) * plotWidth}" y="${height - 12}" text-anchor="middle">${new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short" }).format(new Date(time))}</text>`).join("");

    svg.innerHTML = `
        <defs><linearGradient id="chart-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#72e586" stop-opacity="0.3"></stop><stop offset="100%" stop-color="#72e586" stop-opacity="0"></stop></linearGradient></defs>
        ${phaseRects}${gridLines}${plottedSeries}${dateLabels}
    `;

    const selected = mode === "bodyweight" ? bodyPoints : strengthPoints;
    const first = selected[0]?.value || 0;
    const last = selected.at(-1)?.value || 0;
    const change = first > 0 ? ((last - first) / first) * 100 : 0;
    document.querySelector("#chart-change").textContent = selected.length > 1
        ? `${change >= 0 ? "+" : ""}${change.toFixed(1)}% overall`
        : selected.length ? "First recorded entry" : "";
}

function renderExerciseHistory(sessions) {
    const container = document.querySelector("#exercise-history");
    document.querySelector("#history-count").textContent = `${sessions.length} session${sessions.length === 1 ? "" : "s"}`;
    if (!sessions.length) {
        container.innerHTML = '<p class="empty-history">No completed sets recorded for this exercise yet.</p>';
        return;
    }
    container.innerHTML = [...sessions].reverse().map((session) => `
        <article class="history-session">
            <div class="history-date"><strong>${formatShortDate(session.date)}</strong><small>${escapeHTML(session.split || "Workout")}</small></div>
            <div class="history-sets">${session.sets.map((set) => `<span>${formatWeight(set.weight)} × ${set.reps}</span>`).join("")}</div>
            <div class="history-best"><strong>${session.estimated1RM > 0 ? formatWeight(session.estimated1RM) : "—"}</strong><small>estimated 1RM</small></div>
        </article>
    `).join("");
}

function renderRecentWorkouts() {
    const workouts = [...completedWorkouts()].reverse();
    document.querySelector("#completed-workout-count").textContent = `${workouts.length} total`;
    const container = document.querySelector("#recent-workouts");
    if (!workouts.length) {
        container.innerHTML = '<p class="empty-history">Completed workouts will appear here.</p>';
        return;
    }
    container.innerHTML = workouts.slice(0, 10).map((workout) => {
        const sets = workout.exercises.flatMap((exercise) => exercise.sets).filter((set) => set.weight > 0 && set.reps > 0);
        const volume = sets.reduce((sum, set) => sum + set.weight * set.reps, 0);
        const duration = workout.sessionDurationSeconds > 0 ? ` · ${formatSessionTime(workout.sessionDurationSeconds)}` : "";
        return `<article class="recent-workout"><div><strong>${escapeHTML(workout.split)} Day</strong><small>${formatShortDate(workout.date)}</small></div><div class="recent-workout-stats">${sets.length} sets · ${formatVolume(volume)}${duration}</div></article>`;
    }).join("");
}

function workoutVolume(workout) {
    return workout.exercises.flatMap((exercise) => exercise.sets || [])
        .filter((set) => set.weight > 0 && set.reps > 0)
        .reduce((sum, set) => sum + set.weight * set.reps, 0);
}

function workoutsInRange(start, end) {
    return completedWorkouts().filter((workout) => workout.date >= dateKey(start) && workout.date <= dateKey(end));
}

function startOfWeek(date) {
    return addDays(date, -((date.getDay() + 6) % 7));
}

function calculateStreaks() {
    const first = dateFromKey(state.trackingStartDate);
    const last = history[dateKey(today)]?.status === "complete" ? today : addDays(today, -1);
    let running = 0;
    let longest = 0;
    for (let date = first; date <= last; date = addDays(date, 1)) {
        const scheduled = workoutForDate(date);
        if (scheduled.isRest) continue;
        if (history[dateKey(date)]?.status === "complete") {
            running += 1;
            longest = Math.max(longest, running);
        } else {
            running = 0;
        }
    }
    return { current: running, longest };
}

function renderAnalyticsOverview() {
    const week = workoutsInRange(startOfWeek(today), today);
    const month = workoutsInRange(new Date(today.getFullYear(), today.getMonth(), 1), today);
    document.querySelector("#weekly-volume").textContent = formatVolume(week.reduce((sum, workout) => sum + workoutVolume(workout), 0));
    document.querySelector("#weekly-workouts").textContent = `${week.length} workout${week.length === 1 ? "" : "s"}`;
    document.querySelector("#monthly-volume").textContent = formatVolume(month.reduce((sum, workout) => sum + workoutVolume(workout), 0));
    document.querySelector("#monthly-workouts").textContent = `${month.length} workout${month.length === 1 ? "" : "s"}`;
    const streaks = calculateStreaks();
    document.querySelector("#current-streak").textContent = streaks.current;
    document.querySelector("#longest-streak").textContent = streaks.longest;

    const thirtyDaysAgo = addDays(today, -29);
    const recent = workoutsInRange(thirtyDaysAgo, today);
    document.querySelector("#training-frequency").textContent = (recent.length / (30 / 7)).toFixed(1);
    let planned = 0;
    let completed = 0;
    const consistencyStart = dateFromKey(state.trackingStartDate) > thirtyDaysAgo ? dateFromKey(state.trackingStartDate) : thirtyDaysAgo;
    for (let date = consistencyStart; date <= today; date = addDays(date, 1)) {
        if (workoutForDate(date).isRest) continue;
        planned += 1;
        if (history[dateKey(date)]?.status === "complete") completed += 1;
    }
    document.querySelector("#training-consistency").textContent = planned ? `${Math.round(completed / planned * 100)}%` : "—";
}

function renderCompoundStrength() {
    const compounds = [
        { name: "Bench", ids: ["barbell-bench-press", "bench-press"] },
        { name: "Squat", ids: ["back-squat", "squat"] },
        { name: "Deadlift", ids: ["deadlift"] }
    ];
    document.querySelector("#compound-grid").innerHTML = compounds.map((compound) => {
        const id = compound.ids.find((candidate) => sessionsForExercise(candidate).length) || compound.ids[0];
        const sessions = sessionsForExercise(id).filter((session) => session.estimated1RM > 0);
        const values = sessions.map((session) => session.estimated1RM);
        const best = values.length ? Math.max(...values) : 0;
        const change = values.length > 1 ? (values.at(-1) - values[0]) / values[0] * 100 : 0;
        const max = best || 1;
        const bars = values.slice(-12).map((value) => `<i style="height:${Math.max(8, value / max * 100)}%" title="${formatWeight(value)}"></i>`).join("");
        return `<article class="compound-lift"><span>${compound.name}</span><strong>${best ? formatWeight(best) : "—"}</strong><small>${values.length > 1 ? `${change >= 0 ? "+" : ""}${change.toFixed(1)}% since first entry` : values.length ? "First entry recorded" : "No history yet"}</small><div class="mini-history">${bars}</div></article>`;
    }).join("");
}

function renderRepPerformance(exerciseId) {
    const reps = Number(document.querySelector("#rep-target").value || 5);
    const candidates = sessionsForExercise(exerciseId).flatMap((session) => (
        session.sets.filter((set) => set.reps === reps).map((set) => ({ ...set, date: session.date }))
    ));
    const best = candidates.reduce((current, set) => !current || set.weight > current.weight ? set : current, null);
    document.querySelector("#rep-performance").innerHTML = best
        ? `<div class="rep-result"><span>Best ${reps}-rep set</span><strong>${formatWeight(best.weight)} × ${reps}</strong><small>${formatShortDate(best.date)}</small></div>`
        : `<p class="empty-history">No ${reps}-rep sets recorded for this exercise.</p>`;
}

function renderMuscleVolume() {
    const totals = new Map();
    workoutsInRange(addDays(today, -29), today).forEach((workout) => {
        workout.exercises.forEach((exercise) => {
            const volume = (exercise.sets || []).reduce((sum, set) => sum + (set.weight > 0 && set.reps > 0 ? set.weight * set.reps : 0), 0);
            if (!volume) return;
            totals.set(exercise.primaryMuscle, (totals.get(exercise.primaryMuscle) || 0) + volume);
            (exercise.secondaryMuscles || []).forEach((muscle) => totals.set(muscle, (totals.get(muscle) || 0) + volume * 0.5));
        });
    });
    const rows = [...totals].sort((a, b) => b[1] - a[1]).slice(0, 12);
    const max = rows[0]?.[1] || 1;
    document.querySelector("#muscle-volume-bars").innerHTML = rows.length
        ? rows.map(([muscle, volume]) => `<div class="horizontal-bar-row"><span>${escapeHTML(muscle)}</span><div class="horizontal-bar-track"><div class="horizontal-bar-fill" style="width:${volume / max * 100}%"></div></div><span>${formatVolume(volume)}</span></div>`).join("")
        : '<p class="empty-history">Complete workouts to calculate muscle-group volume.</p>';
}

function rangeStats(startKey, endKey, exerciseId) {
    const workouts = completedWorkouts().filter((workout) => workout.date >= startKey && workout.date <= endKey);
    const sessions = sessionsForExercise(exerciseId).filter((session) => session.date >= startKey && session.date <= endKey);
    return {
        workouts: workouts.length,
        volume: workouts.reduce((sum, workout) => sum + workoutVolume(workout), 0),
        estimated1RM: sessions.length ? Math.max(...sessions.map((session) => session.estimated1RM)) : 0
    };
}

function runDateComparison() {
    const exerciseId = document.querySelector("#progress-exercise").value;
    const a = rangeStats(document.querySelector("#compare-a-start").value, document.querySelector("#compare-a-end").value, exerciseId);
    const b = rangeStats(document.querySelector("#compare-b-start").value, document.querySelector("#compare-b-end").value, exerciseId);
    const result = (label, av, bv, unit = "") => {
        const change = av ? (bv - av) / av * 100 : 0;
        return `<div class="comparison-result"><span>${label}</span><strong>${av.toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit} → ${bv.toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit}</strong><small>${av ? `${change >= 0 ? "+" : ""}${change.toFixed(1)}%` : "No Range A baseline"}</small></div>`;
    };
    const converted = (value) => displayWeight(value);
    document.querySelector("#comparison-results").innerHTML = result("Total volume", converted(a.volume), converted(b.volume), ` ${weightUnit}`) + result("Completed workouts", a.workouts, b.workouts) + result("Best estimated 1RM", converted(a.estimated1RM), converted(b.estimated1RM), ` ${weightUnit}`);
}

function canonicalMuscle(muscle) {
    const map = {
        "Upper Chest": "Chest", Chest: "Chest", Back: "Back", "Upper Back": "Back", Lats: "Back", "Lower Back": "Back",
        Shoulders: "Shoulders", "Front Delts": "Shoulders", "Side Delts": "Shoulders", "Rear Delts": "Shoulders", Traps: "Shoulders",
        Biceps: "Biceps", Triceps: "Triceps", Forearms: "Forearms", Quads: "Quads", Adductors: "Quads", Hamstrings: "Hamstrings",
        Glutes: "Glutes", Calves: "Calves", Abs: "Core", Core: "Core", Obliques: "Core", "Hip Flexors": "Core"
    };
    return map[muscle] || muscle;
}

function renderProgrammingAnalysis() {
    const setTotals = new Map();
    const exerciseDays = new Map();
    const rotationFactor = 7 / Math.max(1, state.split.length);
    state.split.filter((day) => !day.isRest).forEach((day) => {
        day.exerciseIds.forEach((id) => {
            const exercise = catalogById.get(id);
            if (!exercise) return;
            const muscle = canonicalMuscle(exercise.primaryMuscle);
            setTotals.set(muscle, (setTotals.get(muscle) || 0) + 3 * rotationFactor);
            if (!exerciseDays.has(id)) exerciseDays.set(id, []);
            exerciseDays.get(id).push(day.name);
        });
    });
    const totals = [...setTotals].sort((a, b) => b[1] - a[1]);
    document.querySelector("#weekly-muscle-sets").innerHTML = totals.length
        ? totals.map(([muscle, sets]) => `<div class="muscle-set-row"><span>${escapeHTML(muscle)}</span><strong>~${sets.toFixed(1)} sets</strong></div>`).join("")
        : '<p class="empty-history">Add exercises to analyse the split.</p>';

    const notices = [];
    const majorMuscles = ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Quads", "Hamstrings", "Glutes", "Calves", "Core"];
    const underrepresented = majorMuscles.filter((muscle) => (setTotals.get(muscle) || 0) < 3);
    if (underrepresented.length) {
        const suggestions = underrepresented.slice(0, 4).map((muscle) => {
            const exercise = allExercises().find((item) => canonicalMuscle(item.primaryMuscle) === muscle);
            return exercise ? `${muscle}: ${exercise.name}` : muscle;
        });
        notices.push({ warning: false, text: `Lower-coverage groups: ${underrepresented.join(", ")}. Possible additions — ${suggestions.join("; ")}.` });
    }
    const duplicates = [...exerciseDays].filter(([, days]) => days.length > 1);
    duplicates.forEach(([id, days]) => notices.push({ warning: true, text: `${catalogById.get(id)?.name || id} appears on ${days.length} days (${days.join(", ")}). Check that the repetition is intentional.` }));
    totals.filter(([, sets]) => sets > 20).forEach(([muscle, sets]) => notices.push({ warning: true, text: `${muscle} has approximately ${sets.toFixed(1)} direct sets per week, which may be excessive depending on intensity and recovery.` }));
    if (!notices.length) notices.push({ warning: false, text: "No obvious coverage gaps or repeated-exercise warnings were found in the current split." });
    document.querySelector("#analysis-notices").innerHTML = notices.map((notice) => `<div class="analysis-notice${notice.warning ? " warning" : ""}">${escapeHTML(notice.text)}</div>`).join("");
}

function renderBodyweightHistory() {
    const entries = loadJSON(BODYWEIGHT_KEY, []).sort((a, b) => a.date.localeCompare(b.date));
    const change = entries.length > 1 ? entries.at(-1).weight - entries[0].weight : 0;
    document.querySelector("#bodyweight-change").textContent = entries.length > 1 ? `${displayWeight(change) >= 0 ? "+" : ""}${displayWeight(change).toFixed(1)} ${weightUnit} overall` : "";
    document.querySelector("#bodyweight-history").innerHTML = entries.length
        ? [...entries].reverse().slice(0, 12).map((entry) => `<div class="bodyweight-entry"><span>${formatShortDate(entry.date)}</span><strong>${formatWeight(entry.weight)}</strong><button type="button" data-date="${entry.date}" aria-label="Delete bodyweight entry">×</button></div>`).join("")
        : '<p class="empty-history">No bodyweight entries yet.</p>';
    document.querySelectorAll(".bodyweight-entry button").forEach((button) => button.addEventListener("click", () => {
        const updated = loadJSON(BODYWEIGHT_KEY, []).filter((entry) => entry.date !== button.dataset.date);
        localStorage.setItem(BODYWEIGHT_KEY, JSON.stringify(updated));
        renderProgress();
    }));
}

function renderTrainingPhases() {
    const phases = loadJSON(PHASES_KEY, []).sort((a, b) => a.start.localeCompare(b.start));
    document.querySelector("#phase-list").innerHTML = phases.length ? phases.map((phase) => `<div class="phase-entry ${phase.type}"><span>${escapeHTML(phase.type)}</span><strong>${formatShortDate(phase.start)} – ${formatShortDate(phase.end)}</strong><button type="button" data-id="${phase.id}" aria-label="Delete phase">×</button></div>`).join("") : '<p class="empty-history">No training phases added yet.</p>';
    document.querySelectorAll("#phase-list button").forEach((button) => button.addEventListener("click", () => {
        localStorage.setItem(PHASES_KEY, JSON.stringify(phases.filter((phase) => phase.id !== button.dataset.id)));
        renderTrainingPhases();
        renderProgress();
    }));
}

function populateGoalExercises() {
    const select = document.querySelector("#goal-exercise");
    const previous = select.value;
    select.innerHTML = allExercises().sort((a, b) => a.name.localeCompare(b.name)).map((exercise) => `<option value="${escapeHTML(exercise.id)}">${escapeHTML(exercise.name)}</option>`).join("");
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
}

function renderGoals() {
    populateGoalExercises();
    const goals = loadJSON(GOALS_KEY, []);
    document.querySelector("#goal-list").innerHTML = goals.length ? goals.map((goal) => {
        const exercise = catalogById.get(goal.exerciseId);
        const sessions = sessionsForExercise(goal.exerciseId);
        const current = sessions.length ? Math.max(...sessions.map((session) => session.estimated1RM)) : 0;
        const target = estimatedOneRepMax(goal.weight, goal.reps);
        const progress = target > 0 ? Math.min(100, current / target * 100) : 0;
        const predicted = current > 0 ? (goal.reps === 1 ? current : current / (1 + goal.reps / 30)) : 0;
        const ready = current >= target * 0.98;
        return `<article class="goal-entry${ready ? " ready" : ""}"><div class="goal-entry-heading"><strong>${escapeHTML(exercise?.name || goal.exerciseId)}</strong><span>${formatWeight(goal.weight)} × ${goal.reps}</span></div><div class="goal-progress"><i style="width:${progress}%"></i></div><small>${progress.toFixed(0)}% · ${ready ? "Ready to attempt PR" : `Estimated ${formatWeight(predicted)} × ${goal.reps} capability`}</small><footer class="goal-entry-actions"><button class="goal-complete" type="button" data-action="complete" data-id="${goal.id}">✓ Complete goal</button><button class="goal-delete" type="button" data-action="delete" data-id="${goal.id}" aria-label="Delete ${escapeHTML(exercise?.name || "strength")} goal">×</button></footer></article>`;
    }).join("") : '<p class="empty-history">Add a strength goal to track PR readiness.</p>';
    document.querySelectorAll("#goal-list button").forEach((button) => button.addEventListener("click", () => {
        if (button.dataset.action === "complete") completeStrengthGoal(button.dataset.id);
        else {
            localStorage.setItem(GOALS_KEY, JSON.stringify(goals.filter((goal) => goal.id !== button.dataset.id)));
            queueAutosave();
            renderGoals();
            renderWorkout();
        }
    }));
}

function goalReadiness(goal) {
    const sessions = sessionsForExercise(goal.exerciseId);
    const current = sessions.length ? Math.max(...sessions.map((session) => session.estimated1RM)) : 0;
    const target = estimatedOneRepMax(goal.weight, goal.reps);
    return { current, target, progress: target > 0 ? Math.min(100, current / target * 100) : 0, ready: current >= target * 0.98 };
}

function completeStrengthGoal(goalId) {
    const goals = loadJSON(GOALS_KEY, []);
    const goal = goals.find((item) => item.id === goalId);
    if (!goal) return;
    archiveStrengthGoals([goal]);
    showStrengthGoalCelebration([goal]);
    renderGoals();
    renderWorkout();
}

function archiveStrengthGoals(goals, achievedDate = new Date().toISOString()) {
    const achieved = loadJSON(ACHIEVED_GOALS_KEY, []);
    goals.forEach((goal) => achieved.push({ ...goal, achievedAt: achievedDate, readiness: goalReadiness(goal) }));
    localStorage.setItem(ACHIEVED_GOALS_KEY, JSON.stringify(achieved));
    const achievedIds = new Set(goals.map((goal) => goal.id));
    localStorage.setItem(GOALS_KEY, JSON.stringify(loadJSON(GOALS_KEY, []).filter((item) => !achievedIds.has(item.id))));
    queueAutosave();
}

function showStrengthGoalCelebration(goals) {
    if (!goals.length) return;
    const descriptions = goals.map((goal) => `${catalogById.get(goal.exerciseId)?.name || "Strength goal"} — ${formatWeight(goal.weight)} × ${goal.reps}`);
    document.querySelector("#goal-achieved-message").textContent = `${descriptions.join(" · ")}. Good job—your work paid off.`;
    document.body.classList.remove("goal-achievement-flash");
    void document.body.offsetWidth;
    document.body.classList.add("goal-achievement-flash");
    setTimeout(() => document.body.classList.remove("goal-achievement-flash"), 1500);
    document.querySelector("#goal-achieved-dialog").showModal();
    if (navigator.vibrate) navigator.vibrate([30, 45, 45, 45, 80]);
}

function strengthGoalsHitByWorkout(workout) {
    const goals = loadJSON(GOALS_KEY, []);
    const hit = goals.filter((goal) => {
        const exercise = workout.exercises.find((item) => item.id === goal.exerciseId);
        return exercise?.sets?.some((set) => set.weight >= goal.weight && set.reps >= goal.reps);
    });
    if (hit.length) archiveStrengthGoals(hit, `${workout.date}T12:00:00`);
    return hit;
}

function renderAchievedGoals() {
    const achieved = loadJSON(ACHIEVED_GOALS_KEY, []).sort((a, b) => String(b.achievedAt).localeCompare(String(a.achievedAt)));
    document.querySelector("#achieved-goals-list").innerHTML = achieved.length ? achieved.map((goal) => {
        const name = catalogById.get(goal.exerciseId)?.name || goal.exerciseId;
        const date = new Date(goal.achievedAt);
        const dateLabel = Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "long", year: "numeric" }).format(date);
        return `<article><div class="achievement-medal" aria-hidden="true">✓</div><div><strong>${escapeHTML(name)}</strong><span>${formatWeight(goal.weight)} × ${goal.reps}</span><small>Achieved ${dateLabel}</small></div></article>`;
    }).join("") : '<p class="empty-history">Completed strength goals will be kept here with the date you achieved them.</p>';
}

document.querySelector("#open-achieved-goals").addEventListener("click", () => { renderAchievedGoals(); document.querySelector("#achieved-goals-dialog").showModal(); });
document.querySelector("#close-achieved-goals").addEventListener("click", () => document.querySelector("#achieved-goals-dialog").close());

function renderWorkoutGoalAttempts(scheduled, isToday, isRest) {
    const section = document.querySelector("#goal-attempts");
    const goals = loadJSON(GOALS_KEY, []).filter((goal) => scheduled.exerciseIds.includes(goal.exerciseId) && goalReadiness(goal).ready);
    section.hidden = isRest || !isToday || !goals.length;
    if (section.hidden) { document.querySelector("#goal-attempt-list").innerHTML = ""; return; }
    document.querySelector("#goal-attempt-list").innerHTML = goals.map((goal) => {
        const exercise = catalogById.get(goal.exerciseId);
        return `<article><div><strong>${escapeHTML(exercise?.name || goal.exerciseId)} PR attempt</strong><span>${formatWeight(goal.weight)} × ${goal.reps} · ready when you are</span></div><button type="button" data-action="attempt" data-target-exercise="${escapeHTML(goal.exerciseId)}">Start attempt</button></article>`;
    }).join("");
    section.querySelectorAll("[data-action='attempt']").forEach((button) => button.addEventListener("click", () => {
        const card = [...document.querySelectorAll(".exercise-card[data-exercise-id]")].find((item) => item.dataset.exerciseId === button.dataset.targetExercise);
        if (typeof card?.scrollIntoView === "function") card.scrollIntoView({ behavior: "smooth", block: "center" });
        card?.classList.add("pr-attempt-focus");
        setTimeout(() => card?.classList.remove("pr-attempt-focus"), 1800);
        statusMessage.textContent = "PR attempt selected. Warm up properly and only attempt it if your technique feels controlled.";
    }));
}

const progressSections = {
    overview: "Training overview", records: "Personal records", graph: "Main graph", phases: "Training phases", goals: "Strength goals",
    history: "Exercise history", compounds: "Compound strength", "rep-performance": "Best performance by reps", "muscle-volume": "Muscle volume",
    comparison: "Date comparison", bodyweight: "Bodyweight", programming: "Split analysis", recent: "Recent workouts"
};
const defaultProgressSections = new Set(["overview", "records", "graph", "goals", "history", "bodyweight", "programming", "recent"]);

function progressLayoutState() {
    const saved = loadJSON(PROGRESS_LAYOUT_KEY, {});
    if (saved.visibility && (saved.defaultsVersion || 0) < 2) {
        saved.visibility.goals = true;
        saved.visibility.programming = true;
        saved.defaultsVersion = 2;
        localStorage.setItem(PROGRESS_LAYOUT_KEY, JSON.stringify(saved));
        queueAutosave();
    }
    return {
        visibility: saved.visibility || Object.fromEntries(Object.keys(progressSections).map((id) => [id, Object.hasOwn(saved, id) ? saved[id] : defaultProgressSections.has(id)])),
        order: Array.isArray(saved.order) ? [...saved.order, ...Object.keys(progressSections).filter((id) => !saved.order.includes(id))] : Object.keys(progressSections)
    };
}

function applyProgressLayout(layout = progressLayoutState()) {
    const anchor = document.querySelector("#progress-view .backup-card");
    layout.order.forEach((id) => {
        const section = document.querySelector(`[data-progress-section="${id}"]`);
        if (section) anchor.parentElement.insertBefore(section, anchor);
    });
    document.querySelectorAll("[data-progress-section]").forEach((section) => { section.hidden = layout.visibility[section.dataset.progressSection] === false; });
}

function renderProgressSettings() {
    const layout = progressLayoutState();
    const container = document.querySelector("#progress-section-options");
    container.innerHTML = layout.order.map((id, index) => `<div class="progress-option-row" data-section="${id}"><label><input type="checkbox" ${layout.visibility[id] === false ? "" : "checked"}> <span>${progressSections[id]}</span></label><div><button type="button" data-move="up" ${index === 0 ? "disabled" : ""} aria-label="Move ${progressSections[id]} up">↑</button><button type="button" data-move="down" ${index === layout.order.length - 1 ? "disabled" : ""} aria-label="Move ${progressSections[id]} down">↓</button></div></div>`).join("");
    container.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
        const row = button.closest(".progress-option-row");
        const sibling = button.dataset.move === "up" ? row.previousElementSibling : row.nextElementSibling;
        if (!sibling) return;
        if (button.dataset.move === "up") row.parentElement.insertBefore(row, sibling);
        else row.parentElement.insertBefore(sibling, row);
        container.querySelectorAll("button").forEach((control) => { control.disabled = control.dataset.move === "up" ? !control.closest(".progress-option-row").previousElementSibling : !control.closest(".progress-option-row").nextElementSibling; });
    }));
}

function renderProgress() {
    populateProgressExercises();
    const exerciseId = document.querySelector("#progress-exercise").value;
    const sessions = exerciseId ? sessionsForExercise(exerciseId) : [];
    renderRecords(sessions);
    renderProgressChart(sessions);
    renderExerciseHistory(sessions);
    renderRecentWorkouts();
    renderAnalyticsOverview();
    renderCompoundStrength();
    renderRepPerformance(exerciseId);
    renderMuscleVolume();
    renderProgrammingAnalysis();
    renderBodyweightHistory();
    renderTrainingPhases();
    renderGoals();
    applyProgressLayout();
    document.querySelector("#comparison-exercise-name").textContent = catalogById.get(exerciseId)?.name || "";
}

function showView(viewId) {
    document.querySelectorAll(".app-view").forEach((view) => {
        const active = view.id === viewId;
        view.hidden = !active;
        view.classList.toggle("active", active);
    });
    document.querySelectorAll(".tab").forEach((tab) => {
        tab.classList.toggle("active", tab.dataset.view === viewId);
    });
    updateTabIndicator();
    if (viewId === "calendar-view") renderCalendar();
    if (viewId === "progress-view") renderProgress();
}

function updateTabIndicator() {
    const active = document.querySelector(".tab.active");
    const indicator = document.querySelector("#tab-indicator");
    if (!active || !indicator) return;
    indicator.style.width = `${active.offsetWidth}px`;
    indicator.style.transform = `translateX(${active.offsetLeft}px)`;
}

document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => showView(tab.dataset.view));
});
window.addEventListener("resize", updateTabIndicator);
setTimeout(updateTabIndicator, 0);

document.querySelector("#progress-exercise").addEventListener("change", renderProgress);
document.querySelector("#progress-metric").addEventListener("change", renderProgress);
document.querySelector("#progress-graph-mode").addEventListener("change", renderProgress);
document.querySelector("#graph-range").addEventListener("change", renderProgress);
const graphRanges = ["7", "14", "30", "90", "180", "365", "730", "all"];
function zoomGraph(direction) {
    const select = document.querySelector("#graph-range");
    const current = graphRanges.indexOf(select.value);
    select.value = graphRanges[Math.max(0, Math.min(graphRanges.length - 1, current + direction))];
    renderProgress();
}
document.querySelector("#graph-zoom-in").addEventListener("click", () => zoomGraph(-1));
document.querySelector("#graph-zoom-out").addEventListener("click", () => zoomGraph(1));
document.querySelector("#rep-target").innerHTML = Array.from({ length: 15 }, (_, index) => `<option value="${index + 1}"${index === 4 ? " selected" : ""}>${index + 1} reps</option>`).join("");
document.querySelector("#rep-target").addEventListener("change", renderProgress);

const comparisonDefaults = {
    aStart: addDays(today, -55), aEnd: addDays(today, -28),
    bStart: addDays(today, -27), bEnd: today
};
document.querySelector("#compare-a-start").value = dateKey(comparisonDefaults.aStart);
document.querySelector("#compare-a-end").value = dateKey(comparisonDefaults.aEnd);
document.querySelector("#compare-b-start").value = dateKey(comparisonDefaults.bStart);
document.querySelector("#compare-b-end").value = dateKey(comparisonDefaults.bEnd);
document.querySelector("#run-comparison").addEventListener("click", runDateComparison);
document.querySelector("#bodyweight-date").value = dateKey(today);
document.querySelector("#bodyweight-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const date = document.querySelector("#bodyweight-date").value;
    const weight = storedWeight(document.querySelector("#bodyweight-value").value);
    const message = document.querySelector("#bodyweight-message");
    if (!date || !Number.isFinite(weight) || weight <= 0) {
        message.textContent = `Enter a valid bodyweight in ${weightUnit}.`;
        return;
    }
    message.textContent = "";
    const entries = loadJSON(BODYWEIGHT_KEY, []).filter((entry) => entry.date !== date);
    entries.push({ date, weight });
    entries.sort((a, b) => a.date.localeCompare(b.date));
    localStorage.setItem(BODYWEIGHT_KEY, JSON.stringify(entries));
    document.querySelector("#bodyweight-value").value = "";
    renderProgress();
});
document.querySelector("#phase-start").value = dateKey(today);
document.querySelector("#phase-end").value = dateKey(addDays(today, 55));
document.querySelector("#phase-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const start = document.querySelector("#phase-start").value;
    const end = document.querySelector("#phase-end").value;
    const message = document.querySelector("#phase-message");
    if (!start || !end || end < start) {
        message.textContent = "Choose an end date on or after the start date.";
        return;
    }
    message.textContent = "";
    const phases = loadJSON(PHASES_KEY, []);
    phases.push({ id: `phase-${Date.now()}`, type: document.querySelector("#phase-type").value, start, end });
    localStorage.setItem(PHASES_KEY, JSON.stringify(phases));
    renderProgress();
});
document.querySelector("#goal-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const weight = storedWeight(document.querySelector("#goal-weight").value);
    const reps = Number(document.querySelector("#goal-reps").value);
    const message = document.querySelector("#goal-message");
    if (!weight || !reps || reps < 1 || reps > 15) {
        message.textContent = `Enter a goal weight in ${weightUnit} and between 1 and 15 repetitions.`;
        return;
    }
    message.textContent = "";
    const goals = loadJSON(GOALS_KEY, []);
    goals.push({ id: `goal-${Date.now()}`, exerciseId: document.querySelector("#goal-exercise").value, weight, reps });
    localStorage.setItem(GOALS_KEY, JSON.stringify(goals));
    document.querySelector("#goal-weight").value = "";
    renderGoals();
});
document.querySelector("#open-progress-settings").addEventListener("click", () => { renderProgressSettings(); document.querySelector("#progress-settings-dialog").showModal(); });
document.querySelector("#close-progress-settings").addEventListener("click", () => document.querySelector("#progress-settings-dialog").close());
document.querySelector("#progress-settings-form").addEventListener("submit", (event) => event.preventDefault());
document.querySelector("#save-progress-settings").addEventListener("click", () => {
    const rows = [...document.querySelectorAll("#progress-section-options .progress-option-row")];
    const layout = { defaultsVersion: 2, order: rows.map((row) => row.dataset.section), visibility: {} };
    rows.forEach((row) => { layout.visibility[row.dataset.section] = row.querySelector("input").checked; });
    localStorage.setItem(PROGRESS_LAYOUT_KEY, JSON.stringify(layout));
    applyProgressLayout(layout);
    document.querySelector("#progress-settings-dialog").close();
});

function detectPersonalRecords(workout) {
    const records = [];
    workout.exercises.forEach((exercise) => {
        const sets = (exercise.sets || []).filter((set) => set.weight > 0 && set.reps > 0);
        const previous = sessionsForExercise(exercise.id).filter((session) => session.date !== workout.date);
        if (!sets.length || !previous.length) return;
        const priorWeight = Math.max(...previous.map((session) => session.maxWeight));
        const priorOneRM = Math.max(...previous.map((session) => session.estimated1RM));
        const newWeight = Math.max(...sets.map((set) => set.weight));
        const newOneRM = Math.max(...sets.map((set) => estimatedOneRepMax(set.weight, set.reps)));
        const achievements = [];
        if (newWeight > priorWeight) achievements.push(`${formatWeight(newWeight)} weight PR`);
        if (newOneRM > priorOneRM + 0.05) achievements.push(`${formatWeight(newOneRM)} estimated 1RM`);
        if (achievements.length) records.push({ name: exercise.name, achievements });
    });
    return records;
}

function showPRCelebration(records) {
    if (!records.length) return;
    document.querySelector("#pr-title").textContent = records.length === 1 ? "Strength PR!" : `Massive session — ${records.length} PRs`;
    document.querySelector("#pr-records").innerHTML = records.map((record) => `<article><strong>${escapeHTML(record.name)}</strong><div>${record.achievements.map((achievement) => `<span>${escapeHTML(achievement)}</span>`).join("")}</div></article>`).join("");
    document.querySelector("#pr-dialog").showModal();
}

let pendingCompletionPRs = [];
let pendingStrengthGoals = [];

function workoutCompletionFeedback(workout) {
    const comments = workout.exercises.flatMap((exercise) => {
        const sets = (exercise.sets || []).filter((set) => set.weight > 0 && set.reps > 0);
        if (!sets.length) return [];
        const previous = previousPerformanceForExercise(exercise.id, dateFromKey(workout.date));
        if (!previous) return [`${exercise.name}: first performance saved—this is now your baseline.`];
        const oldSets = previous.exercise.sets.filter((set) => set.weight > 0 && set.reps > 0);
        const currentBest = Math.max(...sets.map((set) => estimatedOneRepMax(set.weight, set.reps)));
        const oldBest = Math.max(...oldSets.map((set) => estimatedOneRepMax(set.weight, set.reps)));
        const change = oldBest > 0 ? (currentBest - oldBest) / oldBest * 100 : 0;
        if (change > 1) return [`${exercise.name}: estimated strength improved ${change.toFixed(1)}% from last time.`];
        if (change < -4) return [`${exercise.name}: performance was below last time—repeat the load next session and prioritise clean reps.`];
        return [`${exercise.name}: solid repeat. ${suggestedTarget(exercise, { exercise })}`];
    });
    if (pendingStrengthGoals.length) comments.unshift(`${pendingStrengthGoals.length} strength goal${pendingStrengthGoals.length === 1 ? " was" : "s were"} achieved from your logged sets.`);
    return comments.slice(0, 5);
}

function showWorkoutCompletion(workout, personalRecords = []) {
    const validSets = workout.exercises.flatMap((exercise) => exercise.sets || []).filter((set) => set.weight > 0 && set.reps > 0);
    const completedExercises = workout.exercises.filter((exercise) => exercise.completed).length;
    const volume = validSets.reduce((sum, set) => sum + set.weight * set.reps, 0);
    pendingCompletionPRs = personalRecords;
    document.querySelector("#completion-title").textContent = `${workout.split} complete`;
    document.querySelector("#completion-subtitle").textContent = personalRecords.length
        ? `${personalRecords.length} personal record${personalRecords.length === 1 ? "" : "s"} achieved — details next.`
        : "Session recorded and progress updated.";
    document.querySelector("#completion-stats").innerHTML = `
        <div><strong>${completedExercises}/${workout.exercises.length}</strong><span>Exercises</span></div>
        <div><strong>${validSets.length}</strong><span>Logged sets</span></div>
        <div><strong>${formatVolume(volume)}</strong><span>Volume</span></div>`;
    const feedback = workoutCompletionFeedback(workout);
    document.querySelector("#completion-feedback").innerHTML = feedback.length ? `<h3>Session notes</h3>${feedback.map((comment) => `<p>${escapeHTML(comment)}</p>`).join("")}` : "";
    document.querySelector("#completion-dialog").showModal();
    if (navigator.vibrate) navigator.vibrate([18, 45, 28]);
}

document.querySelector("#close-pr").addEventListener("click", () => {
    document.querySelector("#pr-dialog").close();
    if (pendingStrengthGoals.length) {
        const goals = pendingStrengthGoals;
        pendingStrengthGoals = [];
        showStrengthGoalCelebration(goals);
    } else createDueRecap(true);
});
document.querySelector("#close-completion").addEventListener("click", () => {
    document.querySelector("#completion-dialog").close();
    const records = pendingCompletionPRs;
    pendingCompletionPRs = [];
    if (records.length) showPRCelebration(records);
    else if (pendingStrengthGoals.length) {
        const goals = pendingStrengthGoals;
        pendingStrengthGoals = [];
        showStrengthGoalCelebration(goals);
    } else createDueRecap(true);
});

function collectBackupData() {
    const data = {};
    for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key?.startsWith("liftTracker")) data[key] = localStorage.getItem(key);
    }
    return {
        app: "lift-tracker",
        version: 1,
        exportedAt: new Date().toISOString(),
        data
    };
}

function downloadBackup(file) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function exportBackup() {
    const backup = collectBackupData();
    const filename = `lift-tracker-backup-${dateKey(today)}.json`;
    const file = new File([JSON.stringify(backup, null, 2)], filename, { type: "application/json" });
    const status = document.querySelector("#backup-status");

    try {
        if (navigator.share && navigator.canShare?.({ files: [file] })) {
            await navigator.share({
                files: [file],
                title: "Lift Tracker backup",
                text: "Save this file somewhere safe, such as iCloud Drive."
            });
            status.textContent = "Backup shared successfully.";
        } else {
            downloadBackup(file);
            status.textContent = `Backup downloaded as ${filename}.`;
        }
    } catch (error) {
        if (error.name === "AbortError") {
            status.textContent = "Export cancelled.";
        } else {
            downloadBackup(file);
            status.textContent = `Backup downloaded as ${filename}.`;
        }
    }
}

function validateBackup(backup) {
    if (!backup || backup.app !== "lift-tracker" || backup.version !== 1) {
        throw new Error("This is not a supported Lift Tracker backup.");
    }
    if (!backup.data || typeof backup.data !== "object" || Array.isArray(backup.data)) {
        throw new Error("The backup does not contain valid tracker data.");
    }
    const entries = Object.entries(backup.data);
    if (!entries.length || entries.some(([key, value]) => !key.startsWith("liftTracker") || typeof value !== "string")) {
        throw new Error("The backup contains invalid storage entries.");
    }
    entries.forEach(([, value]) => JSON.parse(value));
    return entries;
}

async function importBackupFile(file) {
    const status = document.querySelector("#backup-status");
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
        status.textContent = "That file is too large to be a Lift Tracker backup.";
        return;
    }

    try {
        const backup = JSON.parse(await file.text());
        const entries = validateBackup(backup);
        const workoutCount = Object.values(JSON.parse(backup.data[HISTORY_KEY] || "{}"))
            .filter((entry) => entry.status === "complete").length;
        const confirmed = window.confirm(
            `Restore this backup from ${new Date(backup.exportedAt).toLocaleString("en-AU")} containing ${workoutCount} completed workout${workoutCount === 1 ? "" : "s"}?\n\nThis will replace the Lift Tracker data currently stored on this device.`
        );
        if (!confirmed) {
            status.textContent = "Import cancelled.";
            return;
        }

        const rollback = collectBackupData();
        try {
            Object.keys(rollback.data).forEach((key) => localStorage.removeItem(key));
            entries.forEach(([key, value]) => localStorage.setItem(key, value));
        } catch (storageError) {
            Object.keys(backup.data).forEach((key) => localStorage.removeItem(key));
            Object.entries(rollback.data).forEach(([key, value]) => localStorage.setItem(key, value));
            throw storageError;
        }

        window.alert("Backup restored successfully. Lift Tracker will now reload.");
        window.location.reload();
    } catch (error) {
        status.textContent = error instanceof SyntaxError
            ? "That file is damaged or is not valid JSON."
            : error.message || "The backup could not be restored.";
    } finally {
        document.querySelector("#backup-file").value = "";
    }
}

document.querySelector("#export-backup").addEventListener("click", exportBackup);
document.querySelector("#import-backup").addEventListener("click", () => document.querySelector("#backup-file").click());
document.querySelector("#backup-file").addEventListener("change", (event) => importBackupFile(event.target.files[0]));

workoutForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const loggedSetCount = [...document.querySelectorAll(".set-row")].filter((row) => Number(row.querySelector(".weight-input").value) > 0 && Number(row.querySelector(".reps-input").value) > 0).length;
    if (!loggedSetCount && !window.confirm("No weighted sets have been entered. Save this workout as completed anyway?")) return;
    pauseSessionTimer();
    const workout = readWorkoutFromPage();
    sessionTimerState = { elapsedSeconds: 0, running: false, startedAt: null };
    saveSessionTimer();
    renderSessionTimer();
    const personalRecords = detectPersonalRecords(workout);
    history[dateKey(viewedDate)] = { ...workout, status: "complete" };
    saveHistory();
    pendingStrengthGoals = strengthGoalsHitByWorkout(workout);
    localStorage.removeItem(DRAFT_PREFIX + dateKey(viewedDate));
    renderWorkout();
    statusMessage.textContent = viewedDate < today
        ? "Past workout saved — calendar marked green."
        : "Workout completed — calendar marked green.";
    showWorkoutCompletion(workout, personalRecords);
    createDueRecap(false);
});

document.querySelector("#miss-workout").addEventListener("click", () => {
    const scheduled = workoutForDate(viewedDate);
    if (scheduled.isRest) {
        statusMessage.textContent = "Rest days cannot be marked as missed. Use Skip rest if you want to train today.";
        return;
    }
    const warning = viewedDate < today ? " This will also recalculate every scheduled day after it." : "";
    if (!window.confirm(`Mark ${scheduled.name} on ${formatShortDate(dateKey(viewedDate))} as missed and move the split forward one day?${warning}`)) return;
    const undo = scheduleSnapshot();
    history[dateKey(viewedDate)] = {
        date: dateKey(viewedDate), status: "missed", split: scheduled.name, splitIndex: scheduled.index
    };
    saveHistory();
    localStorage.removeItem(DRAFT_PREFIX + dateKey(viewedDate));
    renderWorkout();
    statusMessage.textContent = `${scheduled.name} marked missed. It repeats on ${formatShortDate(dateKey(addDays(viewedDate, 1)))}.`;
    offerScheduleUndo(`${scheduled.name} marked missed.`, undo);
});

document.querySelector("#skip-rest-day").addEventListener("click", () => {
    const scheduled = workoutForDate(viewedDate);
    if (!scheduled.isRest) return;
    if (!window.confirm(`Skip this rest day and bring the next workout forward to ${formatShortDate(dateKey(viewedDate))}?`)) return;
    const undo = scheduleSnapshot();
    delete history[dateKey(viewedDate)];
    state.scheduleAdjustments.push({ effectiveDate: dateKey(viewedDate), delta: 1 });
    removeMissedEntriesNowOnRestDays();
    saveState();
    renderWorkout();
    renderCalendar();
    statusMessage.textContent = `Rest skipped. ${workoutForDate(viewedDate).name} is now scheduled today.`;
    offerScheduleUndo("Rest day skipped.", undo);
});

document.querySelector("#return-today").addEventListener("click", () => { miniCalendarOffset = 0; viewWorkoutDate(today); });

document.querySelector("#previous-month").addEventListener("click", () => {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
    calendarSelectedDate = startOfDay(calendarCursor);
    renderCalendar();
});

document.querySelector("#next-month").addEventListener("click", () => {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
    calendarSelectedDate = startOfDay(calendarCursor);
    renderCalendar();
});

document.querySelector("#today-button").addEventListener("click", () => {
    calendarCursor = new Date(today.getFullYear(), today.getMonth(), 1);
    calendarSelectedDate = today;
    renderCalendar();
});

function shiftRotation(direction) {
    const undo = scheduleSnapshot();
    const before = workoutForDate(today).name;
    const change = direction === "earlier" ? 1 : -1;
    const preservePrevious = document.querySelector("#preserve-previous-dates").checked;
    const adjustment = { effectiveDate: dateKey(today), delta: change };
    if (preservePrevious) state.scheduleAdjustments.push(adjustment);
    else state.scheduleOffset += change;
    const after = workoutForDate(today).name;
    const wording = direction === "earlier" ? "one day earlier" : "one day later";
    const scope = preservePrevious ? "today and all future workouts" : "the complete schedule, including previous planned dates";
    if (!window.confirm(`Move ${scope} ${wording}?\n\nToday's scheduled workout will change from ${before} to ${after}. Completed workout records will not be changed.`)) {
        if (preservePrevious) state.scheduleAdjustments.pop();
        else state.scheduleOffset -= change;
        return;
    }
    saveState();
    const clearedMissedRest = removeMissedEntriesNowOnRestDays();
    renderWorkout();
    renderCalendar();
    statusMessage.textContent = `Rotation shifted ${wording}${preservePrevious ? " from today onward" : ""}. Today is now ${workoutForDate(today).name}.${clearedMissedRest ? " A missed marker that moved onto a rest day was cleared." : ""}`;
    offerScheduleUndo(`Rotation shifted ${wording}.`, undo);
}

document.querySelector("#shift-earlier").addEventListener("click", () => shiftRotation("earlier"));
document.querySelector("#shift-later").addEventListener("click", () => shiftRotation("later"));

// Exercise catalogue and split editing
const catalogDialog = document.querySelector("#catalog-dialog");
let editingDayIndex = 0;
let selectedExerciseIds = [];

function nextOccurrenceOfDay(dayId, fromDate = viewedDate) {
    for (let offset = 0; offset < 366; offset += 1) {
        const candidate = addDays(fromDate, offset);
        if (workoutForDate(candidate)?.id === dayId) return candidate;
    }
    return fromDate;
}

function allExercises() {
    return [...EXERCISE_CATALOG, ...state.customExercises];
}

function populateCatalogFilters() {
    const muscles = [...new Set(allExercises().flatMap((exercise) => (
        [exercise.primaryMuscle, ...exercise.secondaryMuscles]
    )))].sort();
    const equipment = [...new Set(allExercises().map((exercise) => exercise.equipment))].sort();
    const muscleSelect = document.querySelector("#muscle-filter");
    const equipmentSelect = document.querySelector("#equipment-filter");
    const currentMuscle = muscleSelect.value;
    const currentEquipment = equipmentSelect.value;
    muscleSelect.innerHTML = `<option value="all">All muscles</option>${muscles.map((item) => `<option value="${escapeHTML(item)}">${escapeHTML(item)}</option>`).join("")}`;
    equipmentSelect.innerHTML = `<option value="all">All equipment</option>${equipment.map((item) => `<option value="${escapeHTML(item)}">${escapeHTML(item)}</option>`).join("")}`;
    if (muscles.includes(currentMuscle)) muscleSelect.value = currentMuscle;
    if (equipment.includes(currentEquipment)) equipmentSelect.value = currentEquipment;
}

function renderDaySelector() {
    const selector = document.querySelector("#day-selector");
    selector.innerHTML = "";
    state.split.forEach((day, index) => {
        if (day.isRest) return;
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = day.name;
        button.className = index === editingDayIndex ? "active" : "";
        button.addEventListener("click", () => selectEditingDay(index));
        selector.append(button);
    });
}

function selectEditingDay(index) {
    editingDayIndex = index;
    const day = state.split[index];
    const targetDate = nextOccurrenceOfDay(day.id, viewedDate);
    selectedExerciseIds = [...exerciseIdsForDate(targetDate, day)];
    document.querySelector("#catalog-day-name").textContent = day.name;
    document.querySelector("#catalog-message").textContent = "";
    renderDaySelector();
    renderCatalog();
    renderSelectedExercises();
}

function exerciseMatchesFilters(exercise) {
    const query = document.querySelector("#exercise-search").value.trim().toLowerCase();
    const muscle = document.querySelector("#muscle-filter").value;
    const equipment = document.querySelector("#equipment-filter").value;
    const searchable = `${exercise.name} ${exercise.primaryMuscle} ${exercise.secondaryMuscles.join(" ")} ${exercise.equipment}`.toLowerCase();
    const matchesMuscle = muscle === "all" || exercise.primaryMuscle === muscle || exercise.secondaryMuscles.includes(muscle);
    return searchable.includes(query) && matchesMuscle && (equipment === "all" || exercise.equipment === equipment);
}

function renderCatalog() {
    const exercises = allExercises();
    const matches = exercises.filter(exerciseMatchesFilters);
    document.querySelector("#catalog-count").textContent = `${matches.length} of ${exercises.length} exercises`;
    const container = document.querySelector("#exercise-catalog");
    container.innerHTML = "";
    matches.forEach((exercise) => {
        const label = document.createElement("label");
        label.className = "catalog-exercise";
        label.innerHTML = `
            <input type="checkbox" value="${exercise.id}" ${selectedExerciseIds.includes(exercise.id) ? "checked" : ""}>
            <span><strong>${escapeHTML(exercise.name)}</strong><small>${escapeHTML(exercise.primaryMuscle)} · ${escapeHTML(exercise.equipment)}</small></span>
        `;
        label.querySelector("input").addEventListener("change", (event) => {
            if (event.target.checked) {
                if (!selectedExerciseIds.includes(exercise.id)) selectedExerciseIds.push(exercise.id);
            } else {
                selectedExerciseIds = selectedExerciseIds.filter((id) => id !== exercise.id);
            }
            renderSelectedExercises();
        });
        container.append(label);
    });
}

function renderSelectedExercises() {
    document.querySelector("#selected-count").textContent = selectedExerciseIds.length;
    const list = document.querySelector("#selected-exercises");
    list.innerHTML = "";
    selectedExerciseIds.forEach((id, index) => {
        const item = document.createElement("li");
        item.innerHTML = `
            <span>${index + 1}. ${escapeHTML(catalogById.get(id)?.name || id)}</span>
            <span class="reorder-buttons">
                <button type="button" data-action="up" aria-label="Move exercise up">↑</button>
                <button type="button" data-action="down" aria-label="Move exercise down">↓</button>
                <button class="remove-item" type="button" data-action="remove" aria-label="Remove exercise">×</button>
            </span>
        `;
        item.querySelectorAll("button").forEach((button) => {
            button.addEventListener("click", () => reorderSelectedExercise(index, button.dataset.action));
        });
        list.append(item);
    });
}

function reorderSelectedExercise(index, action) {
    if (action === "remove") {
        selectedExerciseIds.splice(index, 1);
    } else {
        const target = action === "up" ? index - 1 : index + 1;
        if (target < 0 || target >= selectedExerciseIds.length) return;
        [selectedExerciseIds[index], selectedExerciseIds[target]] = [selectedExerciseIds[target], selectedExerciseIds[index]];
    }
    renderSelectedExercises();
    renderCatalog();
}

function slugify(value) {
    return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function addCustomExercise() {
    const name = document.querySelector("#custom-exercise-name").value.trim();
    const primaryMuscle = document.querySelector("#custom-exercise-muscle").value.trim();
    const equipment = document.querySelector("#custom-exercise-equipment").value.trim();
    const secondaryMuscles = document.querySelector("#custom-exercise-secondary").value
        .split(",").map((item) => item.trim()).filter(Boolean);
    const message = document.querySelector("#custom-exercise-message");
    if (!name || !primaryMuscle || !equipment) {
        message.textContent = "Name, primary muscle and equipment are required.";
        return;
    }

    let id = `custom-${slugify(name) || "exercise"}`;
    let suffix = 2;
    while (catalogById.has(id)) id = `custom-${slugify(name)}-${suffix++}`;
    const exercise = { id, name, primaryMuscle, equipment, secondaryMuscles, custom: true };
    state.customExercises.push(exercise);
    catalogById.set(id, exercise);
    selectedExerciseIds.push(id);
    saveState();
    ["custom-exercise-name", "custom-exercise-muscle", "custom-exercise-equipment", "custom-exercise-secondary"]
        .forEach((field) => { document.querySelector(`#${field}`).value = ""; });
    message.textContent = `${name} added and selected.`;
    populateCatalogFilters();
    renderCatalog();
    renderSelectedExercises();
}

function openCatalog() {
    const current = workoutForDate(viewedDate);
    editingDayIndex = current.isRest ? state.split.findIndex((day) => !day.isRest) : current.index;
    document.querySelector("#range-start").value = dateKey(viewedDate);
    document.querySelector("#range-end").value = dateKey(addDays(viewedDate, 28));
    document.querySelector("#change-scope-details").open = window.innerWidth > 760;
    selectEditingDay(editingDayIndex);
    catalogDialog.showModal();
}

function saveCatalogSelection() {
    if (!selectedExerciseIds.length) {
        document.querySelector("#catalog-message").textContent = "Select at least one exercise.";
        return;
    }

    const day = state.split[editingDayIndex];
    const scope = document.querySelector('input[name="change-scope"]:checked').value;
    const targetDate = nextOccurrenceOfDay(day.id, viewedDate);
    let successMessage = "";

    if (scope === "future") {
        day.exerciseIds = [...selectedExerciseIds];
        successMessage = `${day.name} updated for all future rotations.`;
    } else if (scope === "once") {
        state.exerciseRules.push({
            type: "once", dayId: day.id, dayName: day.name, date: dateKey(targetDate), exerciseIds: [...selectedExerciseIds]
        });
        successMessage = `${day.name} updated for ${dateKey(targetDate)} only.`;
    } else if (scope === "interval") {
        const intervalWeeks = Number(document.querySelector("#interval-weeks").value);
        if (!Number.isInteger(intervalWeeks) || intervalWeeks < 2) {
            document.querySelector("#catalog-message").textContent = "Choose an interval of at least two weeks.";
            return;
        }
        state.exerciseRules.push({
            type: "interval", dayId: day.id, dayName: day.name, startDate: dateKey(targetDate), intervalWeeks,
            exerciseIds: [...selectedExerciseIds]
        });
        successMessage = `${day.name} variation scheduled every ${intervalWeeks} weeks.`;
    } else {
        const startDate = document.querySelector("#range-start").value;
        const endDate = document.querySelector("#range-end").value;
        if (!startDate || !endDate || endDate < startDate) {
            document.querySelector("#catalog-message").textContent = "Choose a valid start and end date.";
            return;
        }
        state.exerciseRules.push({
            type: "range", dayId: day.id, dayName: day.name, startDate, endDate,
            exerciseIds: [...selectedExerciseIds]
        });
        successMessage = `${day.name} updated from ${startDate} to ${endDate}.`;
    }

    saveState();
    catalogDialog.close();
    renderWorkout();
    renderCalendar();
    statusMessage.textContent = successMessage;
}

const splitDialog = document.querySelector("#split-dialog");
let workingSplit = [];

function makeDayId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function openSplitEditor() {
    workingSplit = structuredClone(state.split);
    document.querySelector("#custom-split-name").value = state.splitName;
    document.querySelector("#split-editor-message").textContent = "";
    renderEditableDays();
    splitDialog.showModal();
}

function renderEditableDays() {
    const list = document.querySelector("#editable-days");
    list.innerHTML = "";
    workingSplit.forEach((day, index) => {
        const item = document.createElement("li");
        item.className = `editable-day${day.isRest ? " rest-row" : ""}`;
        item.innerHTML = `
            <span class="day-kind">${day.isRest ? "R" : "W"}</span>
            <input type="text" maxlength="40" value="${escapeHTML(day.name)}" aria-label="Day ${index + 1} name">
            <span class="reorder-buttons">
                <button type="button" data-action="up" aria-label="Move day up">↑</button>
                <button type="button" data-action="down" aria-label="Move day down">↓</button>
                <button class="remove-item" type="button" data-action="remove" aria-label="Delete day">×</button>
            </span>
        `;
        item.querySelector("input").addEventListener("input", (event) => {
            day.name = event.target.value;
        });
        item.querySelectorAll("button").forEach((button) => {
            button.addEventListener("click", () => editDayOrder(index, button.dataset.action));
        });
        list.append(item);
    });
}

function editDayOrder(index, action) {
    if (action === "remove") {
        if (workingSplit.length === 1) {
            document.querySelector("#split-editor-message").textContent = "A split needs at least one day.";
            return;
        }
        workingSplit.splice(index, 1);
    } else {
        const target = action === "up" ? index - 1 : index + 1;
        if (target < 0 || target >= workingSplit.length) return;
        [workingSplit[index], workingSplit[target]] = [workingSplit[target], workingSplit[index]];
    }
    renderEditableDays();
}

function addSplitDay(isRest) {
    workingSplit.push({
        id: makeDayId(isRest ? "rest" : "workout"),
        name: isRest ? "Rest" : `Workout ${workingSplit.filter((day) => !day.isRest).length + 1}`,
        isRest,
        exerciseIds: []
    });
    renderEditableDays();
}

function saveSplitChanges() {
    const splitName = document.querySelector("#custom-split-name").value.trim();
    const message = document.querySelector("#split-editor-message");
    if (!splitName) {
        message.textContent = "Give the split a name.";
        return;
    }
    if (workingSplit.some((day) => !day.name.trim())) {
        message.textContent = "Every day needs a name.";
        return;
    }
    if (!workingSplit.some((day) => !day.isRest)) {
        message.textContent = "Add at least one workout day.";
        return;
    }

    const currentDayId = workoutForDate(today)?.id;
    const newCurrentIndex = workingSplit.findIndex((day) => day.id === currentDayId);
    state.splitName = splitName;
    state.split = structuredClone(workingSplit);
    state.startDate = dateKey(today);
    state.startingIndex = newCurrentIndex >= 0 ? newCurrentIndex : 0;
    state.scheduleOffset = 0;
    saveState();
    splitDialog.close();
    renderWorkout();
    renderCalendar();
    statusMessage.textContent = `${splitName} saved. The new rotation starts today.`;
}

// Rest timer
let timerDuration = Number(localStorage.getItem("liftTrackerRestTimerSeconds")) || 90;
let timerRemaining = timerDuration;
let timerEndAt = null;
let timerInterval = null;

function formatTimer(seconds) {
    const safe = Math.max(0, Math.ceil(seconds));
    return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function renderTimer() {
    document.querySelector("#timer-display").textContent = timerRemaining > 0 ? formatTimer(timerRemaining) : "DONE";
    document.querySelector("#timer-toggle").textContent = timerInterval ? "Pause" : timerRemaining > 0 ? "Start" : "Restart";
    document.querySelectorAll(".timer-presets button").forEach((button) => {
        button.classList.toggle("active", Number(button.dataset.seconds) === timerDuration);
    });
}

function timerTick() {
    timerRemaining = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
    renderTimer();
    if (timerRemaining === 0) {
        clearInterval(timerInterval);
        timerInterval = null;
        timerEndAt = null;
        navigator.vibrate?.([180, 100, 180]);
        renderTimer();
    }
}

function toggleTimer() {
    if (timerInterval) {
        timerTick();
        clearInterval(timerInterval);
        timerInterval = null;
        timerEndAt = null;
    } else {
        if (timerRemaining <= 0) timerRemaining = timerDuration;
        timerEndAt = Date.now() + timerRemaining * 1000;
        timerInterval = setInterval(timerTick, 250);
    }
    renderTimer();
}

function resetTimer(seconds = timerDuration) {
    clearInterval(timerInterval);
    timerInterval = null;
    timerEndAt = null;
    timerDuration = seconds;
    timerRemaining = seconds;
    localStorage.setItem("liftTrackerRestTimerSeconds", String(seconds));
    renderTimer();
}

document.querySelector("#timer-toggle").addEventListener("click", toggleTimer);
document.querySelector("#timer-reset").addEventListener("click", () => resetTimer());
document.querySelectorAll(".timer-presets button").forEach((button) => {
    button.addEventListener("click", () => resetTimer(Number(button.dataset.seconds)));
});
document.addEventListener("visibilitychange", () => {
    if (!document.hidden && timerInterval) timerTick();
});
renderTimer();

// Session length timer
const SESSION_TIMER_KEY = "liftTrackerSessionTimerV1";
let sessionTimerState = {
    elapsedSeconds: 0,
    running: false,
    startedAt: null,
    ...loadJSON(SESSION_TIMER_KEY, {})
};
let sessionTimerInterval = null;

function getSessionElapsedSeconds() {
    const liveSeconds = sessionTimerState.running && sessionTimerState.startedAt
        ? (Date.now() - sessionTimerState.startedAt) / 1000
        : 0;
    return Math.max(0, Math.floor(sessionTimerState.elapsedSeconds + liveSeconds));
}

function formatSessionTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remaining = seconds % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function saveSessionTimer() {
    localStorage.setItem(SESSION_TIMER_KEY, JSON.stringify(sessionTimerState));
}

function renderSessionTimer() {
    document.querySelector("#session-timer-display").textContent = formatSessionTime(getSessionElapsedSeconds());
    document.querySelector("#session-timer-toggle").textContent = sessionTimerState.running ? "Pause session" : getSessionElapsedSeconds() ? "Resume session" : "Start session";
}

function startSessionTimer() {
    if (sessionTimerState.running) {
        sessionTimerState.elapsedSeconds = getSessionElapsedSeconds();
        sessionTimerState.running = false;
        sessionTimerState.startedAt = null;
        clearInterval(sessionTimerInterval);
        sessionTimerInterval = null;
    } else {
        sessionTimerState.running = true;
        sessionTimerState.startedAt = Date.now();
        sessionTimerInterval = setInterval(renderSessionTimer, 1000);
    }
    saveSessionTimer();
    renderSessionTimer();
}

function pauseSessionTimer() {
    if (!sessionTimerState.running) return;
    sessionTimerState.elapsedSeconds = getSessionElapsedSeconds();
    sessionTimerState.running = false;
    sessionTimerState.startedAt = null;
    clearInterval(sessionTimerInterval);
    sessionTimerInterval = null;
    saveSessionTimer();
    renderSessionTimer();
}

function resetSessionTimer() {
    if (getSessionElapsedSeconds() > 0 && !window.confirm("Reset the session length timer to zero?")) return;
    clearInterval(sessionTimerInterval);
    sessionTimerInterval = null;
    sessionTimerState = { elapsedSeconds: 0, running: false, startedAt: null };
    saveSessionTimer();
    renderSessionTimer();
}

document.querySelector("#session-timer-toggle").addEventListener("click", startSessionTimer);
document.querySelector("#session-timer-reset").addEventListener("click", resetSessionTimer);
if (sessionTimerState.running) sessionTimerInterval = setInterval(renderSessionTimer, 1000);
renderSessionTimer();

// Appearance
const APPEARANCE_KEY = "liftTrackerAppearance";
const appearanceDialog = document.querySelector("#appearance-dialog");
let savedAppearance = {
    mode: "system",
    accent: "#72e586",
    showRestTimer: true,
    showSessionTimer: false,
    showExerciseRest: false,
    texture: "none",
    showRecapPopup: true,
    recapTiming: "weekly",
    weightUnit,
    ...loadJSON(APPEARANCE_KEY, {})
};
let appearanceDraft = { ...savedAppearance };

function updateToolVisibility(appearance = savedAppearance) {
    const isRest = workoutForDate(viewedDate)?.isRest;
    document.querySelector("#rest-timer").hidden = isRest || !appearance.showRestTimer;
    document.querySelector("#session-timer").hidden = isRest || !appearance.showSessionTimer;
    document.body.classList.toggle("rest-timer-enabled", !isRest && appearance.showRestTimer);
}

function applyAppearance(appearance) {
    document.documentElement.dataset.theme = appearance.mode;
    document.documentElement.dataset.texture = appearance.texture || "none";
    document.documentElement.style.setProperty("--accent", appearance.accent);
    const light = appearance.mode === "light" || (appearance.mode === "system" && matchMedia("(prefers-color-scheme: light)").matches);
    document.querySelector('meta[name="theme-color"]').content = light ? "#f3f6f3" : appearance.mode === "oled" ? "#000000" : "#101311";
    updateToolVisibility(appearance);
}

function renderAppearanceControls() {
    const radio = document.querySelector(`input[name="theme-mode"][value="${appearanceDraft.mode}"]`);
    if (radio) radio.checked = true;
    document.querySelector("#custom-accent").value = appearanceDraft.accent;
    document.querySelector("#show-rest-timer").checked = appearanceDraft.showRestTimer;
    document.querySelector("#show-session-timer").checked = appearanceDraft.showSessionTimer;
    document.querySelector("#show-exercise-rest").checked = appearanceDraft.showExerciseRest === true;
    const textureRadio = document.querySelector(`input[name="background-texture"][value="${appearanceDraft.texture || "none"}"]`);
    if (textureRadio) textureRadio.checked = true;
    document.querySelector("#show-recap-popup").checked = appearanceDraft.showRecapPopup !== false;
    document.querySelector("#recap-timing").value = appearanceDraft.recapTiming === "split" ? "split-rest" : appearanceDraft.recapTiming || "weekly";
    const unitRadio = document.querySelector(`input[name="weight-unit"][value="${appearanceDraft.weightUnit || weightUnit}"]`);
    if (unitRadio) unitRadio.checked = true;
    document.querySelectorAll("#accent-options button").forEach((button) => {
        button.classList.toggle("active", button.dataset.accent.toLowerCase() === appearanceDraft.accent.toLowerCase());
    });
}

function openAppearance() {
    appearanceDraft = { ...savedAppearance };
    renderAppearanceControls();
    appearanceDialog.showModal();
}

function closeAppearance() {
    applyAppearance(savedAppearance);
    appearanceDialog.close();
}

function saveAppearance() {
    savedAppearance = { ...appearanceDraft };
    weightUnit = savedAppearance.weightUnit || "kg";
    localStorage.setItem(UNIT_KEY, JSON.stringify(weightUnit));
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(savedAppearance));
    applyAppearance(savedAppearance);
    appearanceDialog.close();
    document.querySelectorAll(".unit-label").forEach((label) => { label.textContent = weightUnit; });
    renderWorkout();
    if (!document.querySelector("#progress-view").hidden) renderProgress();
    createDueRecap(false);
}

document.querySelector("#open-appearance").addEventListener("click", openAppearance);
document.querySelector("#close-appearance").addEventListener("click", closeAppearance);
document.querySelector("#save-appearance").addEventListener("click", saveAppearance);
document.querySelector("#appearance-form").addEventListener("submit", (event) => event.preventDefault());
document.querySelectorAll('input[name="theme-mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
        appearanceDraft.mode = radio.value;
        applyAppearance(appearanceDraft);
    });
});
document.querySelectorAll('input[name="background-texture"]').forEach((radio) => radio.addEventListener("change", () => { appearanceDraft.texture = radio.value; applyAppearance(appearanceDraft); }));
document.querySelectorAll('input[name="weight-unit"]').forEach((radio) => {
    radio.addEventListener("change", () => { appearanceDraft.weightUnit = radio.value; });
});
document.querySelectorAll("#accent-options button").forEach((button) => {
    button.addEventListener("click", () => {
        appearanceDraft.accent = button.dataset.accent;
        applyAppearance(appearanceDraft);
        renderAppearanceControls();
    });
});
document.querySelector("#custom-accent").addEventListener("input", (event) => {
    appearanceDraft.accent = event.target.value;
    applyAppearance(appearanceDraft);
    renderAppearanceControls();
});
document.querySelector("#show-rest-timer").addEventListener("change", (event) => {
    appearanceDraft.showRestTimer = event.target.checked;
    updateToolVisibility(appearanceDraft);
});
document.querySelector("#show-session-timer").addEventListener("change", (event) => {
    appearanceDraft.showSessionTimer = event.target.checked;
    updateToolVisibility(appearanceDraft);
});
document.querySelector("#show-exercise-rest").addEventListener("change", (event) => { appearanceDraft.showExerciseRest = event.target.checked; });
document.querySelector("#show-recap-popup").addEventListener("change", (event) => { appearanceDraft.showRecapPopup = event.target.checked; });
document.querySelector("#recap-timing").addEventListener("change", (event) => { appearanceDraft.recapTiming = event.target.value; });
applyAppearance(savedAppearance);
document.querySelectorAll(".unit-label").forEach((label) => { label.textContent = weightUnit; });

const onboardingDialog = document.querySelector("#onboarding-dialog");
let onboardingStep = 0;
let onboardingCustomSplit = [
    { id: "custom-a", name: "Workout A", exerciseIds: [] },
    { id: "custom-b", name: "Workout B", exerciseIds: [] },
    { id: "custom-rest", name: "Rest", isRest: true, exerciseIds: [] }
];

function onboardingChosenSplit() {
    return document.querySelector('input[name="onboarding-split"]:checked')?.value === "ppl" ? defaultSplit : onboardingCustomSplit;
}

function renderOnboardingCustomSplit() {
    const custom = document.querySelector('input[name="onboarding-split"]:checked')?.value === "custom";
    document.querySelector("#onboarding-split-builder").hidden = !custom;
    const list = document.querySelector("#onboarding-custom-days");
    list.innerHTML = onboardingCustomSplit.map((day, index) => `<li data-index="${index}"><span class="day-kind">${day.isRest ? "R" : "W"}</span><input type="text" maxlength="40" value="${escapeHTML(day.name)}" aria-label="Custom split day ${index + 1} name"><div><button type="button" data-action="up" ${index === 0 ? "disabled" : ""} aria-label="Move day up">↑</button><button type="button" data-action="down" ${index === onboardingCustomSplit.length - 1 ? "disabled" : ""} aria-label="Move day down">↓</button><button type="button" data-action="remove" aria-label="Remove day">×</button></div></li>`).join("");
    list.querySelectorAll("input").forEach((input) => input.addEventListener("input", () => {
        onboardingCustomSplit[Number(input.closest("li").dataset.index)].name = input.value;
        populateOnboardingPositions();
    }));
    list.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
        const index = Number(button.closest("li").dataset.index);
        if (button.dataset.action === "remove") {
            if (onboardingCustomSplit.length <= 1) return;
            onboardingCustomSplit.splice(index, 1);
        } else {
            const target = button.dataset.action === "up" ? index - 1 : index + 1;
            if (target < 0 || target >= onboardingCustomSplit.length) return;
            [onboardingCustomSplit[index], onboardingCustomSplit[target]] = [onboardingCustomSplit[target], onboardingCustomSplit[index]];
        }
        renderOnboardingCustomSplit();
        populateOnboardingPositions();
    }));
}

function populateOnboardingPositions() {
    const split = onboardingChosenSplit();
    const select = document.querySelector("#onboarding-position");
    const previous = Number(select.value);
    select.innerHTML = split.map((day, index) => `<option value="${index}">${escapeHTML(day.name)}${day.isRest ? " (recovery day)" : ""}</option>`).join("");
    select.value = Number.isInteger(previous) && previous < split.length ? String(previous) : "0";
}

function showOnboardingStep(step) {
    onboardingStep = Math.max(0, Math.min(4, step));
    document.querySelectorAll(".onboarding-step").forEach((panel) => { panel.hidden = Number(panel.dataset.step) !== onboardingStep; });
    document.querySelector("#onboarding-back").hidden = onboardingStep === 0;
    document.querySelector("#onboarding-next").textContent = onboardingStep === 0 ? "Get started" : onboardingStep === 4 ? "Finish setup" : onboardingStep === 3 && !document.querySelector("#onboarding-goal-enabled").checked ? "Skip goal" : "Continue";
    document.querySelector("#onboarding-message").textContent = "";
}

function openOnboarding() {
    document.querySelector(`input[name="onboarding-unit"][value="${weightUnit}"]`).checked = true;
    document.querySelector("#onboarding-start-date").value = dateKey(today);
    document.querySelector("#onboarding-rest-timer").checked = savedAppearance.showRestTimer;
    document.querySelector("#onboarding-session-timer").checked = savedAppearance.showSessionTimer;
    document.querySelector("#onboarding-exercise-rest").checked = savedAppearance.showExerciseRest === true;
    document.querySelector("#onboarding-recap-popup").checked = savedAppearance.showRecapPopup !== false;
    document.querySelector("#onboarding-recap-timing").value = savedAppearance.recapTiming === "split" ? "split-rest" : savedAppearance.recapTiming || "weekly";
    const goalSelect = document.querySelector("#onboarding-goal-exercise");
    goalSelect.innerHTML = [...catalogById.values()].sort((a, b) => a.name.localeCompare(b.name)).map((exercise) => `<option value="${escapeHTML(exercise.id)}">${escapeHTML(exercise.name)}</option>`).join("");
    if (catalogById.has("barbell-bench-press")) goalSelect.value = "barbell-bench-press";
    populateOnboardingPositions();
    renderOnboardingCustomSplit();
    showOnboardingStep(0);
    if (!onboardingDialog.open) onboardingDialog.showModal();
}

function finishOnboarding() {
    const startInput = document.querySelector("#onboarding-start-date");
    if (!startInput.value) {
        document.querySelector("#onboarding-message").textContent = "Choose the date you want tracking to begin.";
        startInput.focus();
        return;
    }
    const useRecommended = document.querySelector('input[name="onboarding-split"]:checked').value === "ppl";
    if (useRecommended && completedWorkouts().length && !window.confirm("Apply the recommended PPL schedule? Your completed workout records will stay saved, but the current rotation will be replaced.")) return;
    if (useRecommended) {
        state.split = structuredClone(defaultSplit);
        state.splitName = "Push Pull Legs";
        state.exerciseRules = [];
    } else {
        const splitName = document.querySelector("#onboarding-split-name").value.trim();
        const validDays = onboardingCustomSplit.every((day) => day.name.trim());
        if (!splitName || !validDays || !onboardingCustomSplit.some((day) => !day.isRest)) {
            showOnboardingStep(1);
            document.querySelector("#onboarding-message").textContent = "Give the split and every day a name, with at least one workout day.";
            return;
        }
        state.split = onboardingCustomSplit.map((day, index) => ({ ...day, id: `custom-${Date.now()}-${index}`, name: day.name.trim(), exerciseIds: [] }));
        state.splitName = splitName;
        state.exerciseRules = [];
    }
    const selectedToday = Number(document.querySelector("#onboarding-position").value) || 0;
    const trackingDate = startInput.value;
    const elapsed = daysBetween(dateFromKey(trackingDate), today);
    state.startDate = trackingDate;
    state.trackingStartDate = trackingDate;
    state.startingIndex = ((selectedToday - elapsed) % state.split.length + state.split.length) % state.split.length;
    state.scheduleOffset = 0;
    state.scheduleAdjustments = [];
    const selectedUnit = document.querySelector('input[name="onboarding-unit"]:checked').value;
    weightUnit = selectedUnit;
    savedAppearance = {
        ...savedAppearance,
        weightUnit,
        showRestTimer: document.querySelector("#onboarding-rest-timer").checked,
        showSessionTimer: document.querySelector("#onboarding-session-timer").checked,
        showExerciseRest: document.querySelector("#onboarding-exercise-rest").checked,
        showRecapPopup: document.querySelector("#onboarding-recap-popup").checked,
        recapTiming: document.querySelector("#onboarding-recap-timing").value
    };
    if (document.querySelector("#onboarding-goal-enabled").checked) {
        const enteredWeight = Number(document.querySelector("#onboarding-goal-weight").value);
        const reps = Number(document.querySelector("#onboarding-goal-reps").value);
        if (!enteredWeight || reps < 1 || reps > 15) {
            showOnboardingStep(3);
            document.querySelector("#onboarding-message").textContent = `Enter a valid goal weight and between 1 and 15 repetitions, or untick the goal option to skip it.`;
            return;
        }
        const goals = loadJSON(GOALS_KEY, []);
        goals.push({ id: `goal-${Date.now()}`, exerciseId: document.querySelector("#onboarding-goal-exercise").value, weight: selectedUnit === "lb" ? enteredWeight / 2.2046226218 : enteredWeight, reps });
        localStorage.setItem(GOALS_KEY, JSON.stringify(goals));
    }
    localStorage.setItem(UNIT_KEY, JSON.stringify(weightUnit));
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(savedAppearance));
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ completed: true, completedAt: new Date().toISOString() }));
    saveState();
    applyAppearance(savedAppearance);
    document.querySelectorAll(".unit-label").forEach((label) => { label.textContent = weightUnit; });
    onboardingDialog.close();
    renderWorkout();
    renderCalendar();
    statusMessage.textContent = "Setup complete. Your rotation is ready.";
}

document.querySelectorAll('input[name="onboarding-split"]').forEach((radio) => radio.addEventListener("change", () => { renderOnboardingCustomSplit(); populateOnboardingPositions(); }));
document.querySelector("#onboarding-add-workout").addEventListener("click", () => {
    onboardingCustomSplit.push({ id: `custom-workout-${Date.now()}`, name: `Workout ${String.fromCharCode(65 + onboardingCustomSplit.filter((day) => !day.isRest).length)}`, exerciseIds: [] });
    renderOnboardingCustomSplit();
    populateOnboardingPositions();
});
document.querySelector("#onboarding-add-rest").addEventListener("click", () => {
    onboardingCustomSplit.push({ id: `custom-rest-${Date.now()}`, name: "Rest", isRest: true, exerciseIds: [] });
    renderOnboardingCustomSplit();
    populateOnboardingPositions();
});
document.querySelector("#onboarding-next").addEventListener("click", () => {
    if (onboardingStep === 2 && !document.querySelector("#onboarding-start-date").value) {
        document.querySelector("#onboarding-message").textContent = "Choose a tracking start date to continue.";
        return;
    }
    if (onboardingStep === 3 && document.querySelector("#onboarding-goal-enabled").checked) {
        const weight = Number(document.querySelector("#onboarding-goal-weight").value);
        const reps = Number(document.querySelector("#onboarding-goal-reps").value);
        if (!weight || reps < 1 || reps > 15) {
            document.querySelector("#onboarding-message").textContent = "Enter a valid goal weight and between 1 and 15 repetitions, or untick the goal option to skip it.";
            return;
        }
    }
    if (onboardingStep === 4) finishOnboarding();
    else showOnboardingStep(onboardingStep + 1);
});
document.querySelector("#onboarding-goal-enabled").addEventListener("change", (event) => {
    document.querySelector("#onboarding-goal-fields").hidden = !event.target.checked;
    document.querySelector("#onboarding-next").textContent = event.target.checked ? "Continue" : "Skip goal";
});
document.querySelector("#onboarding-back").addEventListener("click", () => showOnboardingStep(onboardingStep - 1));
document.querySelector("#skip-onboarding").addEventListener("click", () => {
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ completed: false, skippedAt: new Date().toISOString() }));
    onboardingDialog.close();
});
document.querySelector("#onboarding-form").addEventListener("submit", (event) => event.preventDefault());
document.querySelector("#restart-onboarding").addEventListener("click", () => {
    appearanceDialog.close();
    openOnboarding();
});

function draftKeys() {
    return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter((key) => key?.startsWith(DRAFT_PREFIX));
}

document.querySelector("#reset-setup-only").addEventListener("click", () => {
    const confirmed = window.confirm(
        "Reset setup only?\n\nThis will reset your split, rotating schedule, missed-day markers, unfinished workout drafts and Progress-page layout.\n\nCompleted workouts, bodyweight, goals, phases, custom exercises, units, theme and timer preferences will stay saved."
    );
    if (!confirmed) return;
    const customExercises = structuredClone(state.customExercises || []);
    history = Object.fromEntries(Object.entries(history).filter(([, entry]) => entry.status === "complete"));
    state = {
        startDate: dateKey(today), trackingStartDate: dateKey(today), startingIndex: 0, scheduleOffset: 0,
        scheduleAdjustments: [], splitName: "Push Pull Legs", split: structuredClone(defaultSplit), exerciseRules: [], customExercises
    };
    draftKeys().forEach((key) => localStorage.removeItem(key));
    localStorage.removeItem(PROGRESS_LAYOUT_KEY);
    localStorage.removeItem(ONBOARDING_KEY);
    saveState();
    saveHistory();
    writeAutosaveSnapshot();
    appearanceDialog.close();
    renderWorkout();
    renderCalendar();
    openOnboarding();
    document.querySelector("#onboarding-message").textContent = "Your setup was reset. Completed workouts and personal tracking data are still saved.";
});

document.querySelector("#factory-reset-all").addEventListener("click", () => {
    const first = window.confirm(
        "Factory reset Lift Tracker?\n\nThis permanently deletes all Lift Tracker data stored on this device, including workout history, drafts, bodyweight, goals, phases, custom exercises, preferences and autosaves."
    );
    if (!first) return;
    const finalConfirmation = window.confirm("Final confirmation: erase everything and return to first-time setup? This cannot be undone unless you have an exported backup.");
    if (!finalConfirmation) return;
    autosaveEnabled = false;
    clearTimeout(autosaveTimer);
    Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
        .filter((key) => key?.startsWith("liftTracker"))
        .forEach((key) => localStorage.removeItem(key));
    window.location.reload();
});

document.querySelector("#edit-exercises").addEventListener("click", openCatalog);
document.querySelector("#manage-exercises").addEventListener("click", openCatalog);
document.querySelector("#edit-split").addEventListener("click", openSplitEditor);
document.querySelector("#save-catalog").addEventListener("click", saveCatalogSelection);
document.querySelector("#add-custom-exercise").addEventListener("click", addCustomExercise);
document.querySelector("#close-catalog").addEventListener("click", () => catalogDialog.close());
document.querySelector("#catalog-form").addEventListener("submit", (event) => event.preventDefault());
document.querySelector("#close-split").addEventListener("click", () => splitDialog.close());
document.querySelector("#split-form").addEventListener("submit", (event) => event.preventDefault());
document.querySelector("#add-workout-day").addEventListener("click", () => addSplitDay(false));
document.querySelector("#add-rest-day").addEventListener("click", () => addSplitDay(true));
document.querySelector("#save-split").addEventListener("click", saveSplitChanges);
document.querySelectorAll("#exercise-search, #muscle-filter, #equipment-filter").forEach((control) => {
    control.addEventListener("input", renderCatalog);
});
document.querySelectorAll('input[name="change-scope"]').forEach((radio) => {
    radio.addEventListener("change", () => {
        document.querySelector("#range-fields").hidden = radio.value !== "range" || !radio.checked;
        const labels = { future: "All current and future rotations", once: "This workout only", interval: "Repeating variation", range: "Custom date range" };
        if (radio.checked) document.querySelector("#scope-summary").textContent = labels[radio.value];
    });
});

populateCatalogFilters();

saveState();
renderWorkout();
if (!localStorage.getItem(ONBOARDING_KEY)) setTimeout(openOnboarding, 0);
else setTimeout(() => createDueRecap(true), 150);
document.addEventListener("input", queueAutosave);
document.addEventListener("change", queueAutosave);
window.addEventListener("pagehide", writeAutosaveSnapshot);
document.addEventListener("visibilitychange", () => { if (document.hidden) writeAutosaveSnapshot(); });
queueAutosave();
if (autosaveRestored) {
    const status = document.querySelector("#autosave-status");
    if (status) status.textContent = "Your saved data was restored from the cross-version autosave.";
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("./service-worker.js").catch((error) => {
            console.warn("Offline mode could not be enabled:", error);
        });
    });
}
