// Training Plan Builder
const ACTIVITIES = ['Run', 'Bike', 'Swim', 'Hike', 'Strength', 'Yoga'];
const WORKOUT_TYPES = {
    'Run': ['Neuromuscular', 'Anaerobic', 'Long Run', 'Easy Run'],
    'Bike': [],
    'Swim': [],
    'Hike': [],
    'Strength': [],
    'Yoga': []
};
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Default training phases with colors
const DEFAULT_PHASES = [
    { name: 'Base Building', color: '#2196F3' },
    { name: 'Build', color: '#FF9800' },
    { name: 'Peak', color: '#F44336' },
    { name: 'Taper', color: '#9C27B0' },
    { name: 'Recovery', color: '#4CAF50' }
];

let weeks = [];
let copiedWorkout = null;
let phases = DEFAULT_PHASES.map(p => ({ ...p })); // copies: phase edits must not change the defaults
let startDate = null; // Start date for the training plan

// "YYYY-MM-DD" from the local date parts (toISOString() is UTC and can be a day off).
function localDateString(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Escape a stored / imported string before it goes into HTML or an attribute.
function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Saved plan (this browser only) ───────────────────────────────────────────
// The plan (weeks, phases, start date) is written to localStorage after every
// change and read back on load, so a reload does not lose it. Excel export is
// still the way to move a plan to another device.
const PLAN_KEY = 'training_plan_v1';

function savePlan() {
    try {
        localStorage.setItem(PLAN_KEY, JSON.stringify({
            v: 1,
            weeks,
            phases,
            startDate: startDate ? localDateString(startDate) : null
        }));
    } catch { /* storage full or unavailable: the plan stays in memory only */ }
}

// Rebuild a plan from stored data, keeping only fields of the expected type.
// Returns null when the data is not a usable plan (older shape, edited by hand).
function sanitizePlan(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.weeks) || raw.weeks.length === 0) return null;
    const str = v => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');

    // Every stored phase keeps its position (weeks refer to phases by index);
    // a bad name or colour is replaced, not dropped.
    let cleanPhases = Array.isArray(raw.phases)
        ? raw.phases.map(p => ({
            name: str(p?.name) || 'Phase',
            color: /^#[0-9a-f]{6}$/i.test(p?.color) ? p.color : '#2196F3'
        }))
        : [];
    if (cleanPhases.length === 0) cleanPhases = DEFAULT_PHASES.map(p => ({ ...p }));

    const base = Date.now();
    const seen = new Set();
    const cleanWeeks = [];
    for (const [i, w] of raw.weeks.entries()) {
        if (!w || typeof w !== 'object' || !Array.isArray(w.days)) return null;
        let id = Number.isSafeInteger(w.id) ? w.id : base + i;
        while (seen.has(id)) id++;
        seen.add(id);
        const phaseIndex = Number.isInteger(w.phaseIndex) && w.phaseIndex >= 0 && w.phaseIndex < cleanPhases.length
            ? w.phaseIndex : 0;
        cleanWeeks.push({
            id,
            number: i + 1,
            phaseIndex,
            days: DAYS.map((name, d) => {
                const slots = Array.isArray(w.days[d]?.workouts) ? w.days[d].workouts : [];
                return {
                    name,
                    workouts: [0, 1].map(k => {
                        const wo = slots[k];
                        if (!wo || typeof wo !== 'object' || !str(wo.activity)) return null;
                        return {
                            activity: str(wo.activity),
                            distance: str(wo.distance),
                            type: str(wo.type),
                            description: str(wo.description)
                        };
                    })
                };
            })
        });
    }

    let cleanStart = null;
    if (typeof raw.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.startDate)) {
        const d = new Date(raw.startDate + 'T00:00:00');
        if (!isNaN(d.getTime())) cleanStart = d;
    }
    return { weeks: cleanWeeks, phases: cleanPhases, startDate: cleanStart };
}

// True when a saved plan was found and applied.
function restorePlan() {
    let plan = null;
    try {
        plan = sanitizePlan(JSON.parse(localStorage.getItem(PLAN_KEY) || 'null'));
    } catch { /* unreadable: start a new plan */ }
    if (!plan) return false;
    weeks = plan.weeks;
    phases = plan.phases;
    startDate = plan.startDate;
    document.getElementById('startDateInput').value = startDate ? localDateString(startDate) : '';
    return true;
}

function clearPlan() {
    if (!confirm('Clear the whole plan and start again? This also removes the copy saved in this browser.')) return;
    try { localStorage.removeItem(PLAN_KEY); } catch { /* nothing stored */ }
    weeks = [];
    phases = DEFAULT_PHASES.map(p => ({ ...p }));
    startDate = null;
    copiedWorkout = null;
    document.getElementById('startDateInput').value = '';
    addWeek();
    notify('Plan cleared.');
}

// Short status line (bottom of the screen) used for feedback, not pop-ups.
let notifyTimer = null;
function notify(msg) {
    const el = document.getElementById('planStatus');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => el.classList.remove('visible'), 4000);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('addWeekBtn').addEventListener('click', addWeek);
    document.getElementById('importBtn').addEventListener('click', () => {
        document.getElementById('fileInput').click();
    });
    document.getElementById('fileInput').addEventListener('change', importFromExcel);
    document.getElementById('exportBtn').addEventListener('click', exportToExcel);
    document.getElementById('startDateInput').addEventListener('change', (e) => {
        startDate = e.target.value ? new Date(e.target.value + 'T00:00:00') : null;
        renderWeeks();
    });

    // Setup phase management
    setupPhaseManagement();

    // Clear plan: discards the plan, including the saved copy
    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear Plan';
    clearBtn.className = 'secondary-btn clear-plan-btn';
    clearBtn.onclick = clearPlan;
    document.querySelector('.controls').appendChild(clearBtn);

    // Show the saved plan, or start with one empty week
    if (restorePlan()) {
        renderWeeks();
        // Say so only when there is something to restore, not for an untouched empty week.
        const hasContent = weeks.length > 1 || weeks.some(w => w.days.some(d => d.workouts.some(Boolean)));
        if (hasContent) notify('Restored the plan saved in this browser.');
    } else {
        addWeek();
    }
});

function setupPhaseManagement() {
    // Create phase management modal
    const modal = document.createElement('div');
    modal.id = 'phaseModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="phaseModalTitle">
            <button type="button" class="close" aria-label="Close">&times;</button>
            <h2 id="phaseModalTitle">Manage Training Phases</h2>
            <div id="phasesList"></div>
            <button id="addPhaseBtn" class="primary-btn">+ Add Phase</button>
        </div>
    `;
    document.body.appendChild(modal);

    // Add manage phases button
    const manageBtn = document.createElement('button');
    manageBtn.textContent = 'Manage Phases';
    manageBtn.className = 'secondary-btn';
    manageBtn.onclick = showPhaseModal;
    document.querySelector('.controls').appendChild(manageBtn);

    // Modal close handler
    modal.querySelector('.close').onclick = hidePhaseModal;
    window.onclick = (e) => { if (e.target === modal) hidePhaseModal(); };
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'block') hidePhaseModal();
    });

    // Add phase button handler
    document.getElementById('addPhaseBtn').onclick = addPhase;
}

function showPhaseModal() {
    const modal = document.getElementById('phaseModal');
    renderPhasesList();
    phaseModalOpener = document.activeElement;
    modal.style.display = 'block';
    modal.querySelector('.close').focus();
}

// Close the dialog and put focus back on the control that opened it.
let phaseModalOpener = null;
function hidePhaseModal() {
    document.getElementById('phaseModal').style.display = 'none';
    if (phaseModalOpener && document.contains(phaseModalOpener)) phaseModalOpener.focus();
    phaseModalOpener = null;
}

function renderPhasesList() {
    const container = document.getElementById('phasesList');
    container.innerHTML = phases.map((phase, index) => `
        <div class="phase-item">
            <input type="text" value="${esc(phase.name)}" aria-label="Phase name" onchange="updatePhaseName(${index}, this.value)" class="phase-name-input">
            <input type="color" value="${esc(phase.color)}" aria-label="Phase colour" onchange="updatePhaseColor(${index}, this.value)" class="phase-color-input">
            <button onclick="deletePhase(${index})" class="delete-btn">Delete</button>
        </div>
    `).join('');
}

function addPhase() {
    phases.push({ name: 'New Phase', color: '#607D8B' });
    renderPhasesList();
    savePlan();
}

function updatePhaseName(index, name) {
    phases[index].name = name;
    renderWeeks();
}

function updatePhaseColor(index, color) {
    phases[index].color = color;
    renderWeeks();
}

function deletePhase(index) {
    if (phases.length === 1) {
        notify('You must have at least one phase!');
        return;
    }
    if (confirm('Delete this phase? Weeks using it will be set to the first phase.')) {
        phases.splice(index, 1);
        // Reset any weeks using deleted phase
        weeks.forEach(week => {
            if (week.phaseIndex >= phases.length) {
                week.phaseIndex = 0;
            }
        });
        renderPhasesList();
        renderWeeks();
    }
}

// Week ids go into inline handlers and must be unique numbers; two weeks made
// in the same millisecond would otherwise share Date.now().
function newWeekId() {
    let id = Date.now();
    while (weeks.some(w => w.id === id)) id++;
    return id;
}

function addWeek() {
    const weekNumber = weeks.length + 1;
    const week = {
        id: newWeekId(),
        number: weekNumber,
        phaseIndex: 0, // Default to first phase
        days: DAYS.map(day => ({
            name: day,
            workouts: [null, null]
        }))
    };

    weeks.push(week);
    renderWeeks();
}

function updateWeekPhase(weekId, phaseIndex) {
    const week = weeks.find(w => w.id === weekId);
    if (week) {
        week.phaseIndex = phaseIndex;
        renderWeeks();
    }
}

function duplicateWeek(weekId) {
    const weekIndex = weeks.findIndex(w => w.id === weekId);
    if (weekIndex === -1) return;

    const originalWeek = weeks[weekIndex];
    const newWeek = {
        id: newWeekId(),
        number: weeks.length + 1,
        phaseIndex: originalWeek.phaseIndex,
        days: originalWeek.days.map(day => ({
            name: day.name,
            workouts: day.workouts.map(w => w ? { ...w } : null)
        }))
    };

    weeks.push(newWeek);
    renderWeeks();
}

function deleteWeek(weekId) {
    if (weeks.length === 1) {
        notify('You must have at least one week!');
        return;
    }

    if (confirm('Are you sure you want to delete this week?')) {
        weeks = weeks.filter(w => w.id !== weekId);
        // Renumber weeks
        weeks.forEach((week, index) => {
            week.number = index + 1;
        });
        renderWeeks();
    }
}

function updateWorkout(weekId, dayIndex, slotIndex, field, value) {
    const week = weeks.find(w => w.id === weekId);
    if (!week) return;

    const day = week.days[dayIndex];
    if (!day.workouts[slotIndex]) {
        day.workouts[slotIndex] = {
            activity: '',
            distance: '',
            type: '',
            description: ''
        };
    }

    day.workouts[slotIndex][field] = value;

    // Clear workout if activity is empty
    if (field === 'activity' && !value) {
        day.workouts[slotIndex] = null;
    }

    renderWeeks();
}

function copyWorkout(weekId, dayIndex, slotIndex) {
    const week = weeks.find(w => w.id === weekId);
    if (!week) return;

    const workout = week.days[dayIndex].workouts[slotIndex];
    if (!workout) {
        notify('No workout to copy!');
        return;
    }

    copiedWorkout = { ...workout };
    renderWeeks(); // the Paste controls exist only once something is copied
    notify('Workout copied! Click Paste on another workout slot.');
}

function pasteWorkout(weekId, dayIndex, slotIndex) {
    if (!copiedWorkout) {
        notify('No workout copied yet!');
        return;
    }

    const week = weeks.find(w => w.id === weekId);
    if (!week) return;

    week.days[dayIndex].workouts[slotIndex] = { ...copiedWorkout };
    renderWeeks();
}

function clearWorkout(weekId, dayIndex, slotIndex) {
    const week = weeks.find(w => w.id === weekId);
    if (!week) return;

    week.days[dayIndex].workouts[slotIndex] = null;
    renderWeeks();
}

function calculateWeekSummary(week) {
    const summary = {
        run: 0,
        runByType: {
            'Neuromuscular': 0,
            'Anaerobic': 0,
            'Long Run': 0,
            'Easy Run': 0
        },
        bike: 0,
        swim: 0,
        hike: 0,
        strengthDays: 0,
        yogaDays: 0
    };

    week.days.forEach(day => {
        let hasStrength = false;
        let hasYoga = false;

        day.workouts.forEach(workout => {
            if (workout && workout.activity) {
                const activity = workout.activity.toLowerCase();

                if (activity === 'run' && workout.distance) {
                    const distance = parseFloat(workout.distance) || 0;
                    summary.run += distance;
                    if (workout.type && summary.runByType.hasOwnProperty(workout.type)) {
                        summary.runByType[workout.type] += distance;
                    }
                } else if (activity === 'bike' && workout.distance) {
                    summary.bike += parseFloat(workout.distance) || 0;
                } else if (activity === 'swim' && workout.distance) {
                    summary.swim += parseFloat(workout.distance) || 0;
                } else if (activity === 'hike' && workout.distance) {
                    summary.hike += parseFloat(workout.distance) || 0;
                } else if (activity === 'strength') {
                    hasStrength = true;
                } else if (activity === 'yoga') {
                    hasYoga = true;
                }
            }
        });

        if (hasStrength) summary.strengthDays++;
        if (hasYoga) summary.yogaDays++;
    });

    return summary;
}

function getDistanceUnit(activity) {
    return activity === 'Swim' ? 'm' : 'mi';
}

function getDistancePlaceholder(activity) {
    return activity === 'Swim' ? 'Distance (meters)' : 'Distance (miles)';
}

function getDistanceStep(activity) {
    return activity === 'Swim' ? '50' : '0.1';
}

function getWeekDateRange(weekNumber) {
    if (!startDate) return '';

    const weekStart = new Date(startDate);
    weekStart.setDate(weekStart.getDate() + (weekNumber - 1) * 7);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const formatDate = (date) => {
        const month = date.toLocaleDateString('en-US', { month: 'short' });
        const day = date.getDate();
        return `${month} ${day}`;
    };

    return `${formatDate(weekStart)} - ${formatDate(weekEnd)}`;
}

function renderWeeks() {
    const container = document.getElementById('weeksContainer');
    container.innerHTML = '';

    weeks.forEach(week => {
        const weekEl = createWeekElement(week);
        container.appendChild(weekEl);
    });
    savePlan();
}

function createWeekElement(week) {
    const summary = calculateWeekSummary(week);
    const phase = phases[week.phaseIndex] || phases[0];
    const dateRange = getWeekDateRange(week.number);

    const weekDiv = document.createElement('div');
    weekDiv.className = 'week-container';
    weekDiv.style.borderLeft = `8px solid ${/^#[0-9a-f]{6}$/i.test(phase.color) ? phase.color : '#2196F3'}`;

    weekDiv.innerHTML = `
        <div class="week-header">
            <div class="week-title-section">
                <div class="week-title-group">
                    <h3 class="week-title">Week ${week.number}</h3>
                    ${dateRange ? `<span class="week-dates">${dateRange}</span>` : ''}
                </div>
                <select class="phase-selector" aria-label="Training phase" onchange="updateWeekPhase(${week.id}, parseInt(this.value))">
                    ${phases.map((p, idx) => `
                        <option value="${idx}" ${idx === week.phaseIndex ? 'selected' : ''}>
                            ${esc(p.name)}
                        </option>
                    `).join('')}
                </select>
            </div>
            <div class="week-actions">
                <button class="duplicate-week-btn" onclick="duplicateWeek(${week.id})">Duplicate Week</button>
                <button class="delete-week-btn" onclick="deleteWeek(${week.id})">Delete Week</button>
            </div>
        </div>
        
        <div class="week-summary">
            <div class="summary-item summary-item-large">
                <span class="summary-label">Total Run</span>
                <span class="summary-value summary-value-large">${summary.run.toFixed(1)} mi</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Neuromuscular</span>
                <span class="summary-value">${summary.runByType['Neuromuscular'].toFixed(1)} mi</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Anaerobic</span>
                <span class="summary-value">${summary.runByType['Anaerobic'].toFixed(1)} mi</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Long Run</span>
                <span class="summary-value">${summary.runByType['Long Run'].toFixed(1)} mi</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Easy Run</span>
                <span class="summary-value">${summary.runByType['Easy Run'].toFixed(1)} mi</span>
            </div>
            <div class="summary-item summary-item-large">
                <span class="summary-label">Bike</span>
                <span class="summary-value summary-value-large">${summary.bike.toFixed(1)} mi</span>
            </div>
            <div class="summary-item summary-item-large">
                <span class="summary-label">Swim</span>
                <span class="summary-value summary-value-large">${summary.swim.toFixed(0)} m</span>
            </div>
            <div class="summary-item summary-item-large">
                <span class="summary-label">Hike</span>
                <span class="summary-value summary-value-large">${summary.hike.toFixed(1)} mi</span>
            </div>
            <div class="summary-item summary-item-large">
                <span class="summary-label">Days Lifting</span>
                <span class="summary-value summary-value-large">${summary.strengthDays}</span>
            </div>
            <div class="summary-item summary-item-large">
                <span class="summary-label">Days Yoga</span>
                <span class="summary-value summary-value-large">${summary.yogaDays}</span>
            </div>
        </div>
        
        <div class="calendar-grid">
            ${week.days.map((day, dayIndex) => createDayColumn(week.id, day, dayIndex)).join('')}
        </div>
    `;

    return weekDiv;
}

function createDayColumn(weekId, day, dayIndex) {
    return `
        <div class="day-column">
            <div class="day-header">${day.name}</div>
            <div class="day-content">
                ${day.workouts.map((workout, slotIndex) =>
        createWorkoutCard(weekId, dayIndex, slotIndex, workout)
    ).join('')}
            </div>
        </div>
    `;
}

function createWorkoutCard(weekId, dayIndex, slotIndex, workout) {
    const isFilled = workout && workout.activity;

    if (!isFilled) {
        return `
            <div class="workout-card">
                <div class="workout-header">
                    <span class="workout-number">Workout ${slotIndex + 1}</span>
                </div>
                <select class="workout-activity-select" onchange="updateWorkout(${weekId}, ${dayIndex}, ${slotIndex}, 'activity', this.value)">
                    <option value="">Select Activity</option>
                    ${ACTIVITIES.map(act => `<option value="${act}">${act}</option>`).join('')}
                </select>
            </div>
        `;
    }

    const needsDistance = !['Strength', 'Yoga'].includes(workout.activity);
    const workoutTypes = Object.prototype.hasOwnProperty.call(WORKOUT_TYPES, workout.activity) ? WORKOUT_TYPES[workout.activity] : [];

    return `
        <div class="workout-card filled">
            <div class="workout-header">
                <span class="workout-number">Workout ${slotIndex + 1}</span>
            </div>
            
            <select class="workout-activity-select" onchange="updateWorkout(${weekId}, ${dayIndex}, ${slotIndex}, 'activity', this.value)">
                <option value="">Select Activity</option>
                ${ACTIVITIES.map(act =>
        `<option value="${act}" ${act === workout.activity ? 'selected' : ''}>${act}</option>`
    ).join('')}
            </select>
            
            <div class="workout-details">
                ${needsDistance ? `
                    <input type="number" 
                           class="workout-distance-input"
                           step="${getDistanceStep(workout.activity)}" 
                           placeholder="${getDistancePlaceholder(workout.activity)}" 
                           value="${esc(workout.distance || '')}"
                           onchange="updateWorkout(${weekId}, ${dayIndex}, ${slotIndex}, 'distance', this.value)">
                ` : ''}
                
                <textarea class="workout-description" 
                          placeholder="Description (e.g., 5x800m intervals, easy recovery pace, hill repeats...)"
                          onchange="updateWorkout(${weekId}, ${dayIndex}, ${slotIndex}, 'description', this.value)">${esc(workout.description || '')}</textarea>
                
                ${workoutTypes.length > 0 ? `
                    <div class="workout-type-buttons">
                        ${workoutTypes.map(type => `
                            <button class="type-btn ${workout.type === type ? 'active' : ''}"
                                    onclick="updateWorkout(${weekId}, ${dayIndex}, ${slotIndex}, 'type', '${type}')">
                                ${type === 'Long Run' ? 'Long' : type === 'Easy Run' ? 'Easy' : type.substring(0, 5)}
                            </button>
                        `).join('')}
                    </div>
                ` : ''}
                
                <div class="workout-actions">
                    <button class="copy-workout-btn" onclick="copyWorkout(${weekId}, ${dayIndex}, ${slotIndex})">Copy</button>
                    ${copiedWorkout ? `
                        <button class="paste-workout-btn" onclick="pasteWorkout(${weekId}, ${dayIndex}, ${slotIndex})">Paste</button>
                    ` : ''}
                    <button class="clear-workout-btn" onclick="clearWorkout(${weekId}, ${dayIndex}, ${slotIndex})">Clear</button>
                </div>
            </div>
        </div>
    `;
}

function exportToExcel() {
    if (weeks.length === 0) {
        notify('No weeks to export!');
        return;
    }

    // Create a new workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Training Plan');

    // Add start date info if set
    if (startDate) {
        const startDateRow = worksheet.addRow(['Start Date:', startDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })]);
        startDateRow.getCell(1).font = { bold: true, size: 11 };
        startDateRow.getCell(2).font = { size: 11 };
        worksheet.addRow([]);
    }

    // Add header row
    const headerRow = worksheet.addRow(['Phase', 'Week', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
    headerRow.font = { bold: true, size: 12 };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4CAF50' }
    };
    headerRow.height = 25;

    // Set column widths
    worksheet.columns = [
        { width: 18 },  // Phase
        { width: 18 },  // Week (increased to fit date range)
        { width: 25 },  // Monday
        { width: 25 },  // Tuesday
        { width: 25 },  // Wednesday
        { width: 25 },  // Thursday
        { width: 25 },  // Friday
        { width: 25 },  // Saturday
        { width: 25 }   // Sunday
    ];

    // Add week rows
    weeks.forEach(week => {
        const phase = phases[week.phaseIndex] || phases[0];
        const dateRange = getWeekDateRange(week.number);
        const weekLabel = dateRange ? `Week ${week.number}\n${dateRange}` : `Week ${week.number}`;

        const row = worksheet.addRow([phase.name, weekLabel]);
        row.height = 80;

        // Style phase cell with colored background
        const phaseCell = row.getCell(1);
        phaseCell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
        phaseCell.alignment = { horizontal: 'center', vertical: 'middle' };
        phaseCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF' + phase.color.substring(1) }
        };

        // Style week label
        row.getCell(2).font = { bold: true, size: 11 };
        row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

        // Process each day
        week.days.forEach((day, dayIndex) => {
            const cell = row.getCell(dayIndex + 3);
            const richText = [];

            day.workouts.forEach((workout, workoutIndex) => {
                if (workout && workout.activity) {
                    // Add separator between workouts
                    if (workoutIndex > 0) {
                        richText.push({ text: '\n\n' });
                    }

                    // Activity name with type (BOLD)
                    let activityText = workout.activity;
                    if (workout.type) {
                        activityText += ` (${workout.type})`;
                    }
                    richText.push({
                        text: activityText,
                        font: { bold: true, size: 11 }
                    });

                    // Distance (ITALIC)
                    if (workout.distance) {
                        const unit = getDistanceUnit(workout.activity);
                        richText.push({
                            text: `\n${workout.distance} ${unit}`,
                            font: { italic: true, size: 10 }
                        });
                    }

                    // Description (NORMAL)
                    if (workout.description) {
                        richText.push({
                            text: `\n${workout.description}`,
                            font: { size: 10 }
                        });
                    }
                }
            });

            if (richText.length > 0) {
                cell.value = { richText: richText };
            }

            cell.alignment = {
                horizontal: 'left',
                vertical: 'top',
                wrapText: true
            };
        });
    });

    // Add summary section
    worksheet.addRow([]);
    const summaryHeaderRow = worksheet.addRow(['WEEKLY SUMMARIES']);
    summaryHeaderRow.getCell(1).font = { bold: true, size: 14 };
    summaryHeaderRow.getCell(1).alignment = { horizontal: 'center' };
    worksheet.addRow([]);

    // Summary table header
    const summaryHeader = worksheet.addRow([
        'Week', 'Total Run', 'Neuromuscular', 'Anaerobic', 'Long Run',
        'Easy Run', 'Bike', 'Swim', 'Hike', 'Days Lifting', 'Days Yoga'
    ]);
    summaryHeader.font = { bold: true, size: 10 };
    summaryHeader.alignment = { horizontal: 'center', vertical: 'middle' };
    summaryHeader.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFCCCCCC' }
    };

    // Summary data
    weeks.forEach(week => {
        const summary = calculateWeekSummary(week);
        const dateRange = getWeekDateRange(week.number);
        const weekLabel = dateRange ? `Week ${week.number} (${dateRange})` : `Week ${week.number}`;

        worksheet.addRow([
            weekLabel,
            `${summary.run.toFixed(1)} mi`,
            `${summary.runByType['Neuromuscular'].toFixed(1)} mi`,
            `${summary.runByType['Anaerobic'].toFixed(1)} mi`,
            `${summary.runByType['Long Run'].toFixed(1)} mi`,
            `${summary.runByType['Easy Run'].toFixed(1)} mi`,
            `${summary.bike.toFixed(1)} mi`,
            `${summary.swim.toFixed(0)} m`,
            `${summary.hike.toFixed(1)} mi`,
            summary.strengthDays,
            summary.yogaDays
        ]);
    });

    // Generate and download the file
    workbook.xlsx.writeBuffer().then(buffer => {
        const date = localDateString(new Date());
        const blob = new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        saveAs(blob, `training-plan-${date}.xlsx`);
    });
}

async function importFromExcel(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        const workbook = new ExcelJS.Workbook();
        const arrayBuffer = await file.arrayBuffer();
        await workbook.xlsx.load(arrayBuffer);

        const worksheet = workbook.getWorksheet('Training Plan');
        if (!worksheet) {
            notify('Could not find "Training Plan" worksheet. Please use a file exported from this tool.');
            return;
        }

        if (!confirm('This will replace your current training plan. Continue?')) {
            event.target.value = ''; // Reset file input
            return;
        }

        // Clear existing data
        weeks = [];
        startDate = null;
        // A file without a start date must not keep the previous plan's date.
        document.getElementById('startDateInput').value = '';

        // Check for start date in first row
        const firstRow = worksheet.getRow(1);
        if (firstRow.getCell(1).value === 'Start Date:') {
            const dateValue = firstRow.getCell(2).value;
            if (dateValue) {
                // Parse the date string
                const parsedDate = new Date(dateValue);
                if (!isNaN(parsedDate.getTime())) {
                    startDate = parsedDate;
                    // Update the date input
                    const dateInput = document.getElementById('startDateInput');
                    dateInput.value = localDateString(startDate);
                }
            }
        }

        // Parse phases from the data
        const phasesFound = new Map();
        let weekCount = 0;

        // Read week rows (skip header row and potential start date rows)
        worksheet.eachRow((row, rowNumber) => {
            const phaseCell = row.getCell(1);
            const weekCell = row.getCell(2);

            // Skip header, start date, and summary rows
            if (phaseCell.value === 'Phase' || phaseCell.value === 'Start Date:' ||
                phaseCell.value === 'WEEKLY SUMMARIES' || phaseCell.value === 'Week') return;

            // Check if this is a week row
            if (!weekCell.value || !weekCell.value.toString().includes('Week')) return;

            weekCount++;

            // Extract phase info
            const phaseName = phaseCell.value?.toString() || 'Base Building';
            const phaseColor = phaseCell.fill?.fgColor?.argb
                ? '#' + phaseCell.fill.fgColor.argb.substring(2)
                : '#2196F3';

            if (!phasesFound.has(phaseName)) {
                phasesFound.set(phaseName, phaseColor);
            }

            // Create week object
            const week = {
                id: Date.now() + weekCount,
                number: weekCount,
                phaseIndex: 0, // Will be set after phases are created
                days: []
            };

            // Parse each day (columns 3-9)
            DAYS.forEach((dayName, dayIndex) => {
                const cell = row.getCell(dayIndex + 3);
                const day = {
                    name: dayName,
                    workouts: [null, null]
                };

                if (cell.value) {
                    const workouts = parseWorkoutsFromCell(cell);
                    day.workouts = workouts;
                }

                week.days.push(day);
            });

            weeks.push(week);
        });

        // Update phases
        if (phasesFound.size > 0) {
            phases = Array.from(phasesFound.entries()).map(([name, color]) => ({
                name,
                color
            }));
        }

        // Set phase indices for weeks
        weeks.forEach((week, index) => {
            // Find the corresponding row in the worksheet
            let rowNumber = 1;
            let weekRowNumber = null;

            worksheet.eachRow((row, rn) => {
                const weekCell = row.getCell(2);
                if (weekCell.value && weekCell.value.toString().includes(`Week ${week.number}`)) {
                    weekRowNumber = rn;
                }
            });

            if (weekRowNumber) {
                const weekRow = worksheet.getRow(weekRowNumber);
                const phaseName = weekRow.getCell(1).value?.toString();
                const phaseIndex = phases.findIndex(p => p.name === phaseName);
                week.phaseIndex = phaseIndex >= 0 ? phaseIndex : 0;
            }
        });

        // Reset file input
        event.target.value = '';

        // Render the imported data
        renderWeeks();
        notify(`Successfully imported ${weeks.length} weeks!`);

    } catch (error) {
        console.error('Import error:', error);
        notify('Error importing file. Please make sure it\'s a valid training plan Excel file.');
        event.target.value = '';
    }
}

function parseWorkoutsFromCell(cell) {
    const workouts = [null, null];

    if (!cell.value) return workouts;

    let cellText = '';

    // Handle rich text
    if (cell.value.richText) {
        cellText = cell.value.richText.map(part => part.text).join('');
    } else {
        cellText = cell.value.toString();
    }

    // Split by double newlines to separate workouts
    const workoutTexts = cellText.split('\n\n').filter(t => t.trim());

    workoutTexts.forEach((workoutText, index) => {
        if (index >= 2) return; // Only support 2 workouts per day

        const lines = workoutText.split('\n').map(l => l.trim()).filter(l => l);
        if (lines.length === 0) return;

        const workout = {
            activity: '',
            distance: '',
            type: '',
            description: ''
        };

        // First line: Activity and type
        const firstLine = lines[0];
        const typeMatch = firstLine.match(/^(.+?)\s*\((.+?)\)$/);

        if (typeMatch) {
            workout.activity = typeMatch[1].trim();
            workout.type = typeMatch[2].trim();
        } else {
            workout.activity = firstLine;
        }

        // Second line: Distance (if present)
        if (lines.length > 1) {
            const distanceLine = lines[1];
            const distanceMatch = distanceLine.match(/^([\d.]+)\s*(mi|m)$/);
            if (distanceMatch) {
                workout.distance = distanceMatch[1];
                // Description is on third line
                if (lines.length > 2) {
                    workout.description = lines.slice(2).join('\n');
                }
            } else {
                // No distance, this is description
                workout.description = lines.slice(1).join('\n');
            }
        }

        workouts[index] = workout;
    });

    return workouts;
}
