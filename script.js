const defaultSplit = [
    {
        id: "push",
        name: "Push",
        exerciseIds: ["barbell-bench-press", "machine-shoulder-press", "dumbbell-lateral-raise", "tricep-pushdown", "overhead-cable-extension", "single-arm-pushdown"]
    },
    {
        id: "pull",
        name: "Pull",
        exerciseIds: ["lat-pulldown", "seated-cable-row", "reverse-pec-deck", "barbell-curl", "hammer-curl"]
    },
    {
        id: "legs",
        name: "Legs",
        exerciseIds: ["back-squat", "leg-press", "seated-leg-curl", "leg-extension", "standing-calf-raise"]
    },
    { id: "rest", name: "Rest", isRest: true, exerciseIds: [] }
];

const catalogById = new Map(EXERCISE_CATALOG.map((exercise) => [exercise.id, exercise]));

const STATE_KEY = "liftTrackerScheduleStateV2";
const HISTORY_KEY = "liftTrackerWorkoutHistoryV2";
const DRAFT_PREFIX = "liftTrackerDraftV2:";
const today = startOfDay(new Date());
let calendarCursor = new Date(today.getFullYear(), today.getMonth(), 1);
let state = loadState();
let history = loadJSON(HISTORY_KEY, {});
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
        startingIndex: saved.startingIndex || 0,
        splitName: saved.splitName || "Push Pull Legs",
        split: savedSplit,
        exerciseRules: saved.exerciseRules || [],
        customExercises: saved.customExercises || []
    };
}

function saveState() {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

function saveHistory() {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function scheduleIndexFor(date) {
    const startDate = dateFromKey(state.startDate);
    if (date < startDate) return null;

    const missedBeforeDate = Object.values(history).filter((entry) => (
        entry.status === "missed" && dateFromKey(entry.date) >= startDate && dateFromKey(entry.date) < date
    )).length;
    const rawIndex = state.startingIndex + daysBetween(startDate, date) - missedBeforeDate;
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
                placeholder="kg" value="${values.weight ?? ""}" aria-label="Weight for set ${setNumber}">
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

function createExerciseCard(exercise, savedExercise = {}) {
    const card = document.createElement("article");
    card.className = "exercise-card";
    card.dataset.exerciseId = exercise.id;
    card.innerHTML = `
        <header class="exercise-header">
            <div><h3>${escapeHTML(exercise.name)}</h3><p class="equipment">${escapeHTML(exercise.equipment)}</p></div>
            <label class="complete-label" title="Mark ${exercise.name} complete">
                <input class="exercise-complete" type="checkbox" ${savedExercise.completed ? "checked" : ""}>
                <span aria-hidden="true"></span>
            </label>
        </header>
        <div class="sets-list"></div>
        <button class="add-set" type="button">+ Add set</button>
    `;

    const setsContainer = card.querySelector(".sets-list");
    const savedSets = savedExercise.sets?.length ? savedExercise.sets : [{}, {}, {}];
    savedSets.forEach((set, index) => setsContainer.append(createSetRow(index + 1, set)));
    card.querySelector(".add-set").addEventListener("click", () => {
        setsContainer.append(createSetRow(setsContainer.children.length + 1));
        saveDraft();
        updateSummary();
    });
    card.querySelector(".exercise-complete").addEventListener("change", () => {
        saveDraft();
        updateSummary();
    });
    return card;
}

function readWorkoutFromPage() {
    const scheduled = workoutForDate(today);
    return {
        date: dateKey(today),
        split: scheduled.name,
        splitIndex: scheduled.index,
        exercises: scheduled.exercises.map((exercise) => {
            const card = document.querySelector(`[data-exercise-id="${exercise.id}"]`);
            return {
                ...exercise,
                completed: card.querySelector(".exercise-complete").checked,
                sets: [...card.querySelectorAll(".set-row")].map((row) => ({
                    weight: Number(row.querySelector(".weight-input").value) || 0,
                    reps: Number(row.querySelector(".reps-input").value) || 0
                }))
            };
        })
    };
}

function saveDraft() {
    const scheduled = workoutForDate(today);
    if (scheduled && !scheduled.isRest && exerciseList.children.length) {
        localStorage.setItem(DRAFT_PREFIX + dateKey(today), JSON.stringify(readWorkoutFromPage()));
    }
}

function updateSummary() {
    const scheduled = workoutForDate(today);
    if (!scheduled || scheduled.isRest || !exerciseList.children.length) return;
    const workout = readWorkoutFromPage();
    const completed = workout.exercises.filter((exercise) => exercise.completed).length;
    const loggedSets = workout.exercises.flatMap((exercise) => exercise.sets)
        .filter((set) => set.weight > 0 && set.reps > 0);
    const volume = loggedSets.reduce((total, set) => total + set.weight * set.reps, 0);
    document.querySelector("#completed-count").textContent = `${completed}/${scheduled.exercises.length}`;
    document.querySelector("#set-count").textContent = loggedSets.length;
    document.querySelector("#total-volume").textContent = `${volume.toLocaleString()} kg`;
}

function renderUpcoming() {
    const container = document.querySelector("#upcoming-days");
    container.innerHTML = "";
    for (let offset = 0; offset < 4; offset += 1) {
        const date = addDays(today, offset);
        const scheduled = workoutForDate(date);
        const card = document.createElement("div");
        card.className = `upcoming-day${offset === 0 ? " today" : ""}`;
        card.innerHTML = `<span>${offset === 0 ? "Today" : new Intl.DateTimeFormat("en-AU", { weekday: "short" }).format(date)}</span><strong>${escapeHTML(scheduled.name)}</strong>`;
        container.append(card);
    }
}

function renderWorkout() {
    const scheduled = workoutForDate(today);
    const savedDraft = loadJSON(DRAFT_PREFIX + dateKey(today), null);
    exerciseList.innerHTML = "";
    statusMessage.textContent = "";
    document.querySelector("#workout-title").textContent = `${scheduled.name} Day`;
    document.querySelector("#rotation-position").textContent = `Day ${scheduled.index + 1} of ${state.split.length}`;
    document.querySelector("#workout-date").textContent = new Intl.DateTimeFormat("en-AU", {
        weekday: "short", day: "numeric", month: "short"
    }).format(today);

    const isRest = scheduled.isRest;
    workoutForm.hidden = isRest;
    document.querySelector("#workout-summary").hidden = isRest;
    document.querySelector("#rest-panel").hidden = !isRest;
    if (!isRest) {
        scheduled.exercises.forEach((exercise) => {
            const savedExercise = savedDraft?.exercises?.find((item) => item.id === exercise.id);
            exerciseList.append(createExerciseCard(exercise, savedExercise));
        });
        updateSummary();
    }
    renderUpcoming();
    renderSplitList();
}

function renderSplitList() {
    const currentIndex = scheduleIndexFor(today);
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
    if (entry?.status === "complete") return { className: "complete", symbol: "✓" };
    if (entry?.status === "missed") return { className: "missed", symbol: "×" };
    if (scheduled.isRest) return { className: "rest", symbol: "☾" };
    if (date < today) return { className: "missed", symbol: "×" };
    return { className: "planned", symbol: "" };
}

function renderCalendar() {
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
        const cell = document.createElement("div");
        const outside = date.getMonth() !== calendarCursor.getMonth();
        const isToday = dateKey(date) === dateKey(today);
        cell.className = `calendar-day${outside ? " outside" : ""}${isToday ? " today" : ""}`;

        if (!scheduled) {
            cell.innerHTML = `<span class="day-number">${date.getDate()}</span>`;
        } else {
            const status = statusForDate(date, scheduled);
            cell.innerHTML = `
                <span class="day-number">${date.getDate()}</span>
                <span class="day-workout">${escapeHTML(scheduled.name)}</span>
                <span class="day-status ${status.className}">${status.symbol}</span>
            `;
        }
        grid.append(cell);
    }
}

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

function setRecord(valueId, dateId, record, property, unit) {
    document.querySelector(`#${valueId}`).textContent = record ? `${record[property].toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit}` : "—";
    document.querySelector(`#${dateId}`).textContent = record ? formatShortDate(record.date) : "No data yet";
}

function renderRecords(sessions) {
    setRecord("record-one-rm", "record-one-rm-date", bestRecord(sessions, "estimated1RM"), "estimated1RM", " kg");
    setRecord("record-weight", "record-weight-date", bestRecord(sessions, "maxWeight"), "maxWeight", " kg");
    setRecord("record-set-volume", "record-set-volume-date", bestRecord(sessions, "bestSetVolume"), "bestSetVolume", " kg");
    setRecord("record-reps", "record-reps-date", bestRecord(sessions, "maxReps"), "maxReps", " reps");
}

const metricDetails = {
    estimated1RM: { label: "Estimated 1RM", unit: "kg" },
    maxWeight: { label: "Best weight", unit: "kg" },
    volume: { label: "Session volume", unit: "kg" },
    maxReps: { label: "Best set reps", unit: "reps" }
};

function renderProgressChart(sessions) {
    const metric = document.querySelector("#progress-metric").value;
    const details = metricDetails[metric];
    const points = sessions.filter((session) => session[metric] > 0);
    const svg = document.querySelector("#progress-chart");
    const empty = document.querySelector("#chart-empty");
    document.querySelector("#chart-title").textContent = details.label;
    empty.hidden = points.length > 0;
    svg.hidden = points.length === 0;
    if (!points.length) {
        document.querySelector("#chart-change").textContent = "";
        svg.innerHTML = "";
        return;
    }

    const width = 700;
    const height = 300;
    const padding = { left: 58, right: 20, top: 22, bottom: 42 };
    const values = points.map((point) => point[metric]);
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

    const firstDate = dateFromKey(points[0].date).getTime();
    const lastDate = dateFromKey(points.at(-1).date).getTime();
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const xFor = (point, index) => lastDate === firstDate
        ? padding.left + plotWidth / 2
        : padding.left + ((dateFromKey(point.date).getTime() - firstDate) / (lastDate - firstDate)) * plotWidth;
    const yFor = (value) => padding.top + (1 - (value - minValue) / (maxValue - minValue)) * plotHeight;
    const coordinates = points.map((point, index) => ({ x: xFor(point, index), y: yFor(point[metric]), point }));
    const linePoints = coordinates.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const areaPoints = `${padding.left},${height - padding.bottom} ${linePoints} ${coordinates.at(-1).x},${height - padding.bottom}`;

    const gridLines = Array.from({ length: 5 }, (_, index) => {
        const fraction = index / 4;
        const y = padding.top + fraction * plotHeight;
        const value = maxValue - fraction * (maxValue - minValue);
        return `<line class="chart-grid-line" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"></line>
            <text class="chart-axis-label" x="${padding.left - 8}" y="${y + 3}" text-anchor="end">${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</text>`;
    }).join("");
    const circles = coordinates.map(({ x, y, point }) => `
        <circle class="chart-point" cx="${x}" cy="${y}" r="5"><title>${formatShortDate(point.date)}: ${point[metric].toFixed(1)} ${details.unit}</title></circle>
    `).join("");
    const dateLabels = [coordinates[0], ...(coordinates.length > 2 ? [coordinates[Math.floor(coordinates.length / 2)]] : []), ...(coordinates.length > 1 ? [coordinates.at(-1)] : [])]
        .map(({ x, point }) => `<text class="chart-axis-label" x="${x}" y="${height - 12}" text-anchor="middle">${new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short" }).format(dateFromKey(point.date))}</text>`).join("");

    svg.innerHTML = `
        <defs><linearGradient id="chart-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#72e586" stop-opacity="0.3"></stop><stop offset="100%" stop-color="#72e586" stop-opacity="0"></stop></linearGradient></defs>
        ${gridLines}<polygon class="chart-area" points="${areaPoints}"></polygon>
        <polyline class="chart-line" points="${linePoints}"></polyline>${circles}${dateLabels}
    `;

    const first = points[0][metric];
    const last = points.at(-1)[metric];
    const change = first > 0 ? ((last - first) / first) * 100 : 0;
    document.querySelector("#chart-change").textContent = points.length > 1
        ? `${change >= 0 ? "+" : ""}${change.toFixed(1)}% overall`
        : "First recorded session";
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
            <div class="history-sets">${session.sets.map((set) => `<span>${set.weight} kg × ${set.reps}</span>`).join("")}</div>
            <div class="history-best"><strong>${session.estimated1RM > 0 ? `${session.estimated1RM.toFixed(1)} kg` : "—"}</strong><small>estimated 1RM</small></div>
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
        return `<article class="recent-workout"><div><strong>${escapeHTML(workout.split)} Day</strong><small>${formatShortDate(workout.date)}</small></div><div class="recent-workout-stats">${sets.length} sets · ${volume.toLocaleString()} kg</div></article>`;
    }).join("");
}

function renderProgress() {
    populateProgressExercises();
    const exerciseId = document.querySelector("#progress-exercise").value;
    const sessions = exerciseId ? sessionsForExercise(exerciseId) : [];
    renderRecords(sessions);
    renderProgressChart(sessions);
    renderExerciseHistory(sessions);
    renderRecentWorkouts();
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
    if (viewId === "calendar-view") renderCalendar();
    if (viewId === "progress-view") renderProgress();
}

document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => showView(tab.dataset.view));
});

document.querySelector("#progress-exercise").addEventListener("change", renderProgress);
document.querySelector("#progress-metric").addEventListener("change", renderProgress);

workoutForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const workout = readWorkoutFromPage();
    history[dateKey(today)] = { ...workout, status: "complete" };
    saveHistory();
    localStorage.removeItem(DRAFT_PREFIX + dateKey(today));
    statusMessage.textContent = "Workout completed — calendar marked green.";
    renderUpcoming();
});

document.querySelector("#miss-workout").addEventListener("click", () => {
    const scheduled = workoutForDate(today);
    if (!window.confirm(`Mark ${scheduled.name} as missed and move the split forward one day?`)) return;
    history[dateKey(today)] = {
        date: dateKey(today), status: "missed", split: scheduled.name, splitIndex: scheduled.index
    };
    saveHistory();
    localStorage.removeItem(DRAFT_PREFIX + dateKey(today));
    statusMessage.textContent = `${scheduled.name} marked missed. It is now scheduled again tomorrow.`;
    renderUpcoming();
});

document.querySelector("#previous-month").addEventListener("click", () => {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
    renderCalendar();
});

document.querySelector("#next-month").addEventListener("click", () => {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
    renderCalendar();
});

document.querySelector("#today-button").addEventListener("click", () => {
    calendarCursor = new Date(today.getFullYear(), today.getMonth(), 1);
    renderCalendar();
});

// Exercise catalogue and split editing
const catalogDialog = document.querySelector("#catalog-dialog");
let editingDayIndex = 0;
let selectedExerciseIds = [];

function nextOccurrenceOfDay(dayId) {
    for (let offset = 0; offset < 366; offset += 1) {
        const candidate = addDays(today, offset);
        if (workoutForDate(candidate)?.id === dayId) return candidate;
    }
    return today;
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
    const targetDate = nextOccurrenceOfDay(day.id);
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
    const current = workoutForDate(today);
    editingDayIndex = current.isRest ? state.split.findIndex((day) => !day.isRest) : current.index;
    document.querySelector("#range-start").value = dateKey(today);
    document.querySelector("#range-end").value = dateKey(addDays(today, 28));
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
    const targetDate = nextOccurrenceOfDay(day.id);
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
    saveState();
    splitDialog.close();
    renderWorkout();
    renderCalendar();
    statusMessage.textContent = `${splitName} saved. The new rotation starts today.`;
}

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
    });
});

populateCatalogFilters();

saveState();
renderWorkout();
