// Values the server renders into the page, read off this script's own tag.
const PAGE = document.currentScript.dataset;

// ============================================================
// Blockly Block Definitions (shape/colour only — no generators needed)
// ============================================================

Blockly.Blocks['rover_on_receive'] = {
    init: function() {
        this.appendDummyInput()
            .appendField("\uD83D\uDEF0\uFE0F On uplink");
        this.appendStatementInput("DO")
            .setCheck(null);
        this.setColour("#FF6D00");
    }
};

Blockly.Blocks['rover_forward'] = {
    init: function() {
        this.appendDummyInput()
            .appendField("Move Forward")
            .appendField(new Blockly.FieldNumber(1, 0.1, 10, 0.1), "TIME")
            .appendField("seconds");
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour("#2196F3");
    }
};

Blockly.Blocks['rover_backward'] = {
    init: function() {
        this.appendDummyInput()
            .appendField("Move Backward")
            .appendField(new Blockly.FieldNumber(1, 0.1, 10, 0.1), "TIME")
            .appendField("seconds");
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour("#2196F3");
    }
};

Blockly.Blocks['rover_spin_left'] = {
    init: function() {
        this.appendDummyInput()
            .appendField("Spin Left")
            .appendField(new Blockly.FieldNumber(0.5, 0.1, 10, 0.1), "TIME")
            .appendField("seconds");
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour("#9C27B0");
    }
};

Blockly.Blocks['rover_spin_right'] = {
    init: function() {
        this.appendDummyInput()
            .appendField("Spin Right")
            .appendField(new Blockly.FieldNumber(0.5, 0.1, 10, 0.1), "TIME")
            .appendField("seconds");
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour("#9C27B0");
    }
};

Blockly.Blocks['rover_stop'] = {
    init: function() {
        this.appendDummyInput()
            .appendField("Stop");
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour("#f44336");
    }
};

Blockly.Blocks['rover_steer_left'] = {
    init: function() {
        this.appendDummyInput()
            .appendField("Steer Left")
            .appendField(new Blockly.FieldNumber(20, 5, 45, 5), "DEGREES")
            .appendField("degrees for")
            .appendField(new Blockly.FieldNumber(1, 0.1, 10, 0.1), "TIME")
            .appendField("seconds");
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour("#00BCD4");
    }
};

Blockly.Blocks['rover_steer_right'] = {
    init: function() {
        this.appendDummyInput()
            .appendField("Steer Right")
            .appendField(new Blockly.FieldNumber(20, 5, 45, 5), "DEGREES")
            .appendField("degrees for")
            .appendField(new Blockly.FieldNumber(1, 0.1, 10, 0.1), "TIME")
            .appendField("seconds");
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour("#00BCD4");
    }
};

Blockly.Blocks['rover_wait'] = {
    init: function() {
        this.appendDummyInput()
            .appendField("Wait")
            .appendField(new Blockly.FieldNumber(1, 0.1, 10, 0.1), "TIME")
            .appendField("seconds");
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour("#FF9800");
    }
};

Blockly.Blocks['rover_repeat'] = {
    init: function() {
        this.appendDummyInput()
            .appendField("Repeat")
            .appendField(new Blockly.FieldNumber(3, 1, 20, 1), "TIMES")
            .appendField("times");
        this.appendStatementInput("DO")
            .setCheck(null);
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour("#FF9800");
    }
};

Blockly.Blocks['rover_mast_turn'] = {
    init: function() {
        this.appendDummyInput()
            .appendField("Point Mast")
            .appendField(new Blockly.FieldDropdown([
                ["left", "LEFT"],
                ["centre", "CENTRE"],
                ["right", "RIGHT"]
            ]), "DIR")
            .appendField(new Blockly.FieldNumber(45, 5, 80, 5), "DEGREES")
            .appendField("°");
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour("#00897B");
    }
};

Blockly.Blocks['rover_read_distance'] = {
    init: function() {
        this.appendDummyInput()
            .appendField("Read Distance");
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour("#00897B");
    }
};

Blockly.Blocks['rover_take_photo'] = {
    init: function() {
        this.appendDummyInput()
            .appendField("Take a Picture");
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour("#00897B");
    }
};

Blockly.Blocks['rover_distance'] = {
    init: function() {
        this.appendDummyInput()
            .appendField("distance (cm)");
        this.setOutput(true, "Number");
        this.setColour("#00897B");
    }
};

const LED_COLOURS = [
    ["red", "255, 0, 0"],
    ["orange", "255, 96, 0"],
    ["yellow", "255, 200, 0"],
    ["green", "0, 255, 0"],
    ["blue", "0, 0, 255"],
    ["purple", "160, 0, 255"],
    ["pink", "255, 64, 160"],
    ["white", "255, 255, 255"],
    ["off", "0, 0, 0"]
];

const LED_POSITIONS = [
    ["front left", "1"],
    ["front right", "2"],
    ["rear left", "0"],
    ["rear right", "3"]
];

Blockly.Blocks['rover_leds_all'] = {
    init: function() {
        this.appendDummyInput()
            .appendField("Set all LEDs")
            .appendField(new Blockly.FieldDropdown(LED_COLOURS), "COLOUR");
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour("#673AB7");
    }
};

Blockly.Blocks['rover_led_one'] = {
    init: function() {
        this.appendDummyInput()
            .appendField("Set")
            .appendField(new Blockly.FieldDropdown(LED_POSITIONS), "LED")
            .appendField("LED")
            .appendField(new Blockly.FieldDropdown(LED_COLOURS), "COLOUR");
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour("#673AB7");
    }
};

const monitorDarkTheme = Blockly.Theme.defineTheme('monitorDark', {
    base: Blockly.Themes.Classic,
    componentStyles: {
        workspaceBackgroundColour: '#1a1a2e',
        toolboxBackgroundColour: '#16213e',
        scrollbarColour: '#444',
    }
});

// ============================================================
// Camera WebSocket Client (shared, /static/camera-client.js)
// ============================================================

// The camera runs on the same machine as this web server in both
// deployments - the Pi in the yard, a laptop in development - so the
// host is taken from wherever this page was served rather than named.
//
// It used to be pinned to the Pi's mDNS name, so the stream only ever
// worked for someone reaching the Pi by that exact name: opening the
// monitor by IP, or on a dev machine, left it dialling a host that does
// not resolve and sitting on "Connecting..." forever with no clue why.
const CAMERA_WS_URL = `ws://${window.location.hostname}:${PAGE.cameraPort}`;

// ============================================================
// Queue Status Poller
// ============================================================

class QueuePoller {
    constructor() {
        this.roverDot = document.getElementById('roverDot');
        this.roverStatus = document.getElementById('roverStatus');
        this.currentEl = document.getElementById('currentInstruction');
        this.pendingEl = document.getElementById('pendingInstructions');
        this.pendingCountEl = document.getElementById('pendingCount');
        this.historyEl = document.getElementById('historyInstructions');
        this.activeWorkspaces = new Map();
        this.pendingWorkspaces = new Map();
        this.renderCounter = 0;
        this.lastDataJson = null;
        this.seenOutputIds = new Set();
        this.seenInstructionIds = new Set();
        this.latestPhotoId = null;
        this.firstUpdate = true;
    }

    async refresh() {
        try {
            const resp = await fetch('/api/queue/status');
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();
            // Through the page's dispatcher when there is one, so a
            // fetched snapshot reaches the same subscribers an SSE
            // push would. Falls back to painting only, which is all
            // this did before.
            if (this.onStatus) { this.onStatus(data); } else { this.updateUI(data); }
        } catch (e) {
            this.updateStatus('disconnected', 'Disconnected');
            // Rethrown so the loader above can retry. It used to be
            // swallowed here, which left the caller unable to tell a
            // successful load from a failed one.
            throw e;
        }
    }

    updateUI(data) {
        // Skip re-render if data hasn't changed (prevents Blockly flicker)
        const dataJson = JSON.stringify(data);
        if (dataJson === this.lastDataJson) return;
        this.lastDataJson = dataJson;

        // Dispose existing Blockly workspaces before re-render
        this.activeWorkspaces.forEach(ws => ws.dispose());
        this.activeWorkspaces.clear();
        this.pendingWorkspaces = new Map();
        this.renderCounter = 0;

        // Only the newest photo-bearing instruction shows the image
        // (the rover keeps a single latest photo)
        const all = [...(data.history || []), ...(data.current ? [data.current] : [])];
        all.forEach(i => { if (i.photo) this.latestPhotoId = i.id; });

        // Toast fresh student-code output over the camera feed
        // (skip the backlog already in history when the page loads)
        all.forEach(i => {
            if (i.output && !this.seenOutputIds.has(i.id)) {
                this.seenOutputIds.add(i.id);
                if (!this.firstUpdate) showOutputToast(i.output);
            }
        });

        // Current instruction
        if (data.current) {
            this.currentEl.innerHTML = this.renderInstruction(data.current, 'executing');
        } else {
            this.currentEl.innerHTML = '<div class="empty-message">Idle</div>';
        }

        // Pending instructions - queue is FIFO (service.py appends to
        // the end), so a genuinely new row is always the newest one
        // arriving at the bottom of this list.
        this.pendingCountEl.textContent = data.pending_count || 0;
        if (data.pending && data.pending.length > 0) {
            this.pendingEl.innerHTML = data.pending
                .map(i => this.renderInstruction(i, 'pending', 'bottom'))
                .join('');
        } else {
            this.pendingEl.innerHTML = '<div class="empty-message">No pending instructions</div>';
        }

        // History (reversed, most recent first) - a genuinely new row
        // is always the newest one, which lands at the top here.
        if (data.history && data.history.length > 0) {
            this.historyEl.innerHTML = data.history
                .slice().reverse()
                .map(i => this.renderInstruction(i, 'completed', 'top'))
                .join('');
        } else {
            this.historyEl.innerHTML = '<div class="empty-message">No history</div>';
        }

        // Inject Blockly workspaces after DOM is updated
        if (this.pendingWorkspaces.size > 0) {
            setTimeout(() => this.injectBlocklyWorkspaces(), 0);
        }

        // Only after every section above has read it - the pending/
        // history entrance check needs this call's own value, same as
        // the output-toast check above.
        this.firstUpdate = false;
    }

    renderInstruction(instr, status, direction) {
        // Only an instruction this poller has never rendered before
        // (and never on the very first load, which would otherwise
        // replay the whole backlog) gets an entrance animation.
        const isNew = direction && !this.seenInstructionIds.has(instr.id) && !this.firstUpdate;
        this.seenInstructionIds.add(instr.id);
        const enterClass = isNew ? ` enter-${direction}` : '';

        const cmd = instr.cmd || 'unknown';
        const params = instr.params || {};

        let paramsHtml;
        if (cmd === 'run_python' && params.blockly_state) {
            const wsId = `bws-${this.renderCounter++}`;
            this.pendingWorkspaces.set(wsId, params.blockly_state);
            paramsHtml = `<div class="blockly-preview" id="${wsId}"></div>`;
        } else if (cmd === 'run_python') {
            const code = (params.code || '').trimEnd();
            paramsHtml = `<div class="instruction-code">${this.escapeHtml(code)}</div>`;
        } else {
            const paramStr = Object.entries(params)
                .map(([k, v]) => `${k}: ${v}`)
                .join(', ');
            paramsHtml = `<div class="instruction-params">${paramStr || 'no params'}</div>`;
        }

        // blockly_state comes from /code/, which has the workspace and
        // gets the blocks drawn above. params.blockly comes from the run
        // station, which only has the flag Mission Control put in the
        // clipboard - so it gets the name but keeps the Python below it.
        // Either way the screen says this mission was built from blocks.
        const label = (cmd === 'run_python' && (params.blockly_state || params.blockly))
            ? 'Run Blockly'
            : cmd.replace(/_/g, ' ');

        let extraHtml = '';
        if (instr.output) {
            extraHtml += `<div class="instruction-output">${this.escapeHtml(instr.output)}</div>`;
        }
        if (instr.photo) {
            extraHtml += instr.id === this.latestPhotoId
                ? `<img class="instruction-photo" src="/api/photo?t=${encodeURIComponent(instr.id)}" alt="Rover photo">`
                : `<div class="instruction-params">&#128247; photo taken</div>`;
        } else if (instr.photo_attempted) {
            // Photo block ran but capture failed — show it where the
            // picture would have been instead of failing silently
            const why = instr.error ? this.escapeHtml(instr.error) : 'Camera error';
            extraHtml += `<div class="instruction-photo-error">`
                + `<div class="photo-error-title">&#128247; Photo failed</div>`
                + `<div class="photo-error-why">${why}</div></div>`;
        }

        return `
            <div class="instruction ${status}${enterClass}">
                <div class="instruction-icon cmd-${cmd}"></div>
                <div class="instruction-details">
                    <div class="instruction-cmd">${label}</div>
                    ${paramsHtml}
                    ${extraHtml}
                </div>
            </div>
        `;
    }

    injectBlocklyWorkspaces() {
        this.pendingWorkspaces.forEach((blocklyState, wsId) => {
            const el = document.getElementById(wsId);
            if (!el) return;
            try {
                const state = JSON.parse(blocklyState);
                const ws = Blockly.inject(el, {
                    // Self-hosted Blockly resolves its icons from here.
                    media: '/static/vendor/blockly/media/',
                    readOnly: true,
                    scrollbars: false,
                    zoom: { controls: false, wheel: false },
                    theme: monitorDarkTheme
                });
                Blockly.serialization.workspaces.load(state, ws);
                ws.zoomToFit();
                this.activeWorkspaces.set(wsId, ws);
            } catch (e) {
                console.warn('Failed to inject Blockly workspace:', e);
            }
        });
        this.pendingWorkspaces.clear();
    }

    escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    updateStatus(state, text) {
        this.roverDot.className = 'rover-dot ' + state;
        this.roverStatus.textContent = text;
    }
}

// ============================================================
// Initialize
// ============================================================

// Start camera client
const outputToastEl = document.getElementById('outputToast');
let outputToastTimer;
function showOutputToast(text) {
    outputToastEl.textContent = text;
    outputToastEl.classList.add('visible');
    clearTimeout(outputToastTimer);
    outputToastTimer = setTimeout(() => outputToastEl.classList.remove('visible'), 5000);
}

// The shared client reports state; how it looks is this page's business.
// The overlay message hides while frames flow and while the simulator
// owns the canvas, exactly as the inline client did.
const cameraDot = document.getElementById('cameraDot');
const cameraStatusEl = document.getElementById('cameraStatus');
const cameraMessage = document.getElementById('cameraMessage');
const camera = new CameraClient(document.getElementById('cameraCanvas'), {
    onStatus: (state, text) => {
        if (state !== 'disabled') {
            cameraDot.className = 'connection-dot ' + state;
            cameraStatusEl.textContent = text;
        }
        cameraMessage.classList.toggle('hidden',
            state === 'connected' || state === 'disabled');
    },
});
camera.connect(CAMERA_WS_URL);

// Queue — SSE push with manual refresh fallback
const queue = new QueuePoller();

// Extra subscribers to the same stream. Kept as a list rather than a
// second EventSource because each one holds an open proxied connection
// to the rover for the life of the page.
const queueEventSubscribers = [];
let lastStatus = null;

// Every snapshot goes through here, whoever fetched it.
//
// The subscribers used to be called from the SSE handler only, and
// queue.refresh() went straight to updateUI. So the load-time snapshot
// - the only one that carries what happened before the page opened -
// never reached them. The simulated rover view is a subscriber, which
// is why opening the monitor during a run showed a parked rover until
// the rover next changed something.
function dispatchStatus(status) {
    lastStatus = status;
    queue.updateUI(status);
    // A throwing subscriber must not take the queue display down with
    // it - that is the part of this page someone is actually watching.
    for (const fn of queueEventSubscribers) {
        try { fn(status); } catch (e) { console.error('[monitor] subscriber failed:', e); }
    }
}
queue.onStatus = dispatchStatus;

// The backlog arrives here and only here: the SSE stream below carries
// CHANGES, so anything the rover did before this page opened is only
// ever seen through this fetch. One attempt was too few. If it failed -
// a rover blip, or the satellite still coming up behind it - the page
// sat empty until the rover next did something, which on an idle yard
// is a long time, and looked exactly like "the mission I just sent is
// missing".
(function loadBacklog(attempt) {
    queue.refresh().catch(function () {
        if (attempt < 5) setTimeout(function () { loadBacklog(attempt + 1); }, 1000 * attempt);
    });
})(1);

// Belt and braces behind the stream. Cheap: /api/queue/status is a
// local call to the rover, and updateUI returns early when nothing has
// changed, so a quiet yard costs one request and no re-render.
setInterval(function () { queue.refresh(); }, 15000);

const eventSource = new EventSource('/api/queue/events');

eventSource.onopen = () => queue.updateStatus('connected', 'Connected');


eventSource.onmessage = (event) => {
    let status;
    try {
        status = JSON.parse(event.data);
    } catch (e) {
        console.error('SSE parse error:', e);
        return;
    }
    dispatchStatus(status);
};

eventSource.onerror = () => queue.updateStatus('disconnected', 'Disconnected');

document.getElementById('refreshBtn').addEventListener('click', () => queue.refresh());

// Rover badge popover
const roverBadge = document.getElementById('roverBadge');
const roverPopover = document.getElementById('roverPopover');
const popoverUrl = document.getElementById('popoverUrl');
const popoverRoverStatus = document.getElementById('popoverRoverStatus');

async function refreshPopover() {
    try {
        const resp = await fetch('/api/health');
        const data = await resp.json();
        popoverUrl.textContent = data.rover_url || '—';
        popoverRoverStatus.textContent = data.rover_status || '—';
    } catch (e) {
        popoverUrl.textContent = '—';
        popoverRoverStatus.textContent = 'unreachable';
    }
}

roverBadge.addEventListener('click', async (e) => {
    e.stopPropagation();
    const isVisible = roverPopover.classList.toggle('visible');
    if (isVisible) await refreshPopover();
});

document.addEventListener('click', () => {
    roverPopover.classList.remove('visible');
});

// Handed to the simulator module below. Deliberately a narrow surface
// rather than letting it reach into this script's internals.
window.__yardMonitorHooks = {
    camera,
    // Subscribers get the last snapshot immediately, then every one
    // after it. Without that first call a late subscriber misses the
    // only snapshot that carries the backlog: the simulated rover view
    // is a module script that awaits /api/status before it registers,
    // so by the time it arrived the load fetch had already dispatched
    // and it had nothing to replay - a parked rover on a yard that had
    // just run a mission.
    onQueueEvent: (fn) => {
        queueEventSubscribers.push(fn);
        if (lastStatus) {
            try { fn(lastStatus); } catch (e) { console.error('[monitor] subscriber failed:', e); }
        }
    },
    setLabel: (text) => { document.getElementById('cameraStatus').textContent = text; },
};
