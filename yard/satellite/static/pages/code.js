// All 16 block definitions, the toolbox and the Python generator used
// to live here, byte-identical to mission-control's TypeScript, with a
// comment in each copy asking humans to mirror changes into the other.
// They now come from that single source via `npm run build:roversim`,
// and CI fails if this committed output drifts from it.
import {
    defineRoverBlocks,
    ROVER_TOOLBOX,
    ROVER_MAX_INSTANCES,
    mergeUplinkHats,
    workspaceToPython,
} from '/static/roversim/roverBlockly.js';

defineRoverBlocks(Blockly);
// ============================================================
// Ports & Adapters Pattern for Testability
// ============================================================

class RoverService {
    async addToQueue(instructions) { throw new Error("Not implemented"); }
    async clearQueue() { throw new Error("Not implemented"); }
    async getStatus() { throw new Error("Not implemented"); }
}

class RealRoverService extends RoverService {
    constructor(baseUrl) {
        super();
        this.baseUrl = baseUrl;
    }

    async addToQueue(instructions) {
        const resp = await fetch(`${this.baseUrl}/api/queue/add`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(instructions)
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
    }

    async clearQueue() {
        const resp = await fetch(`${this.baseUrl}/api/queue/clear`, {
            method: 'POST'
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
    }

    async getStatus() {
        const resp = await fetch(`${this.baseUrl}/api/queue/status`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
    }

    async checkHealth() {
        try {
            const resp = await fetch(`${this.baseUrl}/api/health`);
            return resp.ok;
        } catch {
            return false;
        }
    }
}

class SpyRoverService extends RoverService {
    constructor(outputElement) {
        super();
        this.output = outputElement;
    }

    async addToQueue(instructions) {
        this.log(`Would send ${instructions.length} instruction(s):`);
        instructions.forEach(i => {
            if (i.cmd === 'run_python') {
                this.log(`  - run_python:`);
                (i.params.code || '').split('\n').forEach(line => {
                    this.log(`      ${line}`);
                });
            } else {
                const params = Object.entries(i.params || {})
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(', ');
                this.log(`  - ${i.cmd} {${params}}`);
            }
        });
        return {status: 'spy', added: instructions.length};
    }

    async clearQueue() {
        this.log('Would clear queue and stop rover');
        return {status: 'spy', cleared: 0};
    }

    async getStatus() {
        return {current: null, pending: [], history: []};
    }

    async checkHealth() {
        return true;
    }

    log(msg) {
        console.log(`[SPY] ${msg}`);
        if (this.output) {
            this.output.innerHTML += `<div>${msg}</div>`;
            this.output.scrollTop = this.output.scrollHeight;
        }
    }

    clear() {
        if (this.output) {
            this.output.innerHTML = '';
        }
    }
}


// ============================================================
// Toolbox Configuration
// ============================================================

const toolbox = ROVER_TOOLBOX;

// ============================================================
// Workspace Initialization
// ============================================================

const workspace = Blockly.inject('blocklyDiv', {
    toolbox: toolbox,
    // Self-hosted Blockly resolves its icons, cursors and sounds from
    // here. Without it they 404 and the trashcan renders blank.
    media: '/static/vendor/blockly/media/',
    // The actual cap - Blockly reads maxInstances only from here,
    // never from a toolbox content entry.
    maxInstances: ROVER_MAX_INSTANCES,
    zoom: {
        controls: true,
        wheel: true,
        startScale: 1.5,
        maxScale: 3,
        minScale: 0.5,
        scaleSpeed: 1.2
    },
    trashcan: true,
    move: {
        scrollbars: true,
        drag: true,
        wheel: true
    },
    grid: {
        spacing: 20,
        length: 3,
        colour: '#333',
        snap: true
    },
    theme: Blockly.Theme.defineTheme('dark', {
        base: Blockly.Themes.Classic,
        componentStyles: {
            workspaceBackgroundColour: '#1a1a2e',
            toolboxBackgroundColour: '#16213e',
            toolboxForegroundColour: '#fff',
            flyoutBackgroundColour: '#252525',
            flyoutForegroundColour: '#ccc',
            flyoutOpacity: 1,
            scrollbarColour: '#555',
            insertionMarkerColour: '#fff',
            insertionMarkerOpacity: 0.3,
            scrollbarOpacity: 0.5,
            cursorColour: '#fff'
        }
    })
});

// Module scope is NOT global, unlike the classic script this used to
// be. The Playwright codegen tests drive the page through these two
// names, so publish them deliberately - a narrow surface, the same way
// monitor.html publishes __yardMonitorHooks - rather than leaving the
// tests to reach into a scope they cannot see.
window.workspace = workspace;
window.workspaceToPython = workspaceToPython;



// ============================================================
// Tab Switching
// ============================================================

let activeTab = 'blockly';

document.getElementById('tabBlockly').addEventListener('click', () => {
    activeTab = 'blockly';
    document.getElementById('tabBlockly').classList.add('active');
    document.getElementById('tabPython').classList.remove('active');
    document.getElementById('paneBlockly').classList.add('active');
    document.getElementById('panePython').classList.remove('active');
    Blockly.svgResize(workspace);
});

document.getElementById('tabPython').addEventListener('click', () => {
    activeTab = 'python';
    document.getElementById('tabPython').classList.add('active');
    document.getElementById('tabBlockly').classList.remove('active');
    document.getElementById('panePython').classList.add('active');
    document.getElementById('paneBlockly').classList.remove('active');
});

// ============================================================
// Service Initialization (DI based on URL param)
// ============================================================

// ?spy=true preferred; ?mock=true kept as a legacy alias for old bookmarks
const urlParams = new URL(location).searchParams;
const isSpyMode = urlParams.get('spy') === 'true' || urlParams.get('mock') === 'true';
const spyOutput = document.getElementById('spyOutput');
const spyPanel = document.getElementById('spyPanel');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

const roverService = isSpyMode
    ? new SpyRoverService(spyOutput)
    : new RealRoverService('');

// Update status indicator
if (isSpyMode) {
    statusDot.classList.add('spy');
    statusText.textContent = 'Spy Mode';
    spyPanel.classList.add('visible');
} else {
    // Check connection status periodically
    async function checkConnection() {
        const connected = await roverService.checkHealth();
        statusDot.classList.toggle('connected', connected);
        statusText.textContent = connected ? 'Connected' : 'Disconnected';
    }
    checkConnection();
    setInterval(checkConnection, 5000);
}

// ============================================================
// UI Event Handlers
// ============================================================

const toast = document.getElementById('toast');

function showToast(message, type = '') {
    toast.textContent = message;
    toast.className = 'toast visible ' + type;
    setTimeout(() => toast.classList.remove('visible'), 3000);
}

document.getElementById('runBtn').addEventListener('click', async () => {
    let code;
    let blockly_state = null;

    if (activeTab === 'blockly') {
        code = workspaceToPython(workspace);
        if (code.trim() === '') {
            showToast('No blocks to run', 'error');
            return;
        }
        blockly_state = JSON.stringify(Blockly.serialization.workspaces.save(workspace));
    } else {
        code = pythonEditor.getValue();
        if (code.trim() === '') {
            showToast('No code to run', 'error');
            return;
        }
    }

    if (isSpyMode) {
        roverService.clear();
    }

    try {
        const params = blockly_state ? {code, blockly_state} : {code};
        const result = await roverService.addToQueue([{cmd: 'run_python', params}]);
        showToast('Sent to rover', 'success');
    } catch (e) {
        showToast('Failed to send: ' + e.message, 'error');
    }
});

document.getElementById('stopBtn').addEventListener('click', async () => {
    try {
        await roverService.clearQueue();
        showToast('Stopped!', 'success');
    } catch (e) {
        showToast('Failed to stop: ' + e.message, 'error');
    }
});

document.getElementById('clearBtn').addEventListener('click', () => {
    if (activeTab === 'blockly') {
        workspace.clear();
        localStorage.removeItem('roverWorkspace');
        const block = workspace.newBlock('rover_on_receive');
        block.initSvg();
        block.render();
        block.moveBy(40, 40);
    } else {
        pythonEditor.setValue('');
        localStorage.removeItem(PYTHON_STORAGE_KEY);
    }
    if (isSpyMode) {
        roverService.clear();
    }
    showToast('Cleared');
});

// Load a mission copied from the queue: Blockly blocks JSON goes to the
// Blockly tab, Python goes to the Python tab. Shared by the Import button
// and the page-wide paste handler below.
function importMission(text) {
    text = (text || '').trim();
    if (!text) return false;
    if (text[0] === '{') {
        try {
            const state = JSON.parse(text);
            if (state && (state.blocks || state.variables)) {
                Blockly.serialization.workspaces.load(state, workspace);
                let merged = false;
                if (mergeUplinkHats(workspace)) {
                    merged = true;
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(Blockly.serialization.workspaces.save(workspace)));
                }
                document.getElementById('tabBlockly').click();
                showToast(merged ? 'Blocks pasted; extra uplinks merged' : 'Blocks pasted', 'success');
                return true;
            }
        } catch (e) { /* not JSON - try as Python below */ }
    }
    if (/rover\.|time\.sleep/.test(text)) {
        if (!pythonEditor) return false;
        pythonEditor.setValue(text);
        document.getElementById('tabPython').click();
        showToast('Code pasted', 'success');
        return true;
    }
    return false;
}

// Import button: read straight from the clipboard, fall back to a prompt.
document.getElementById('importBtn').addEventListener('click', async () => {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch (e) { /* clipboard blocked */ }
    if (!text || !text.trim()) {
        text = prompt('Paste the mission (Blockly blocks JSON or Python) copied from the queue:') || '';
    }
    if (!importMission(text)) showToast('Nothing to import', 'error');
});

// Paste anywhere (Ctrl/Cmd-V or right-click paste) to load a copied
// mission, unless the paste lands in the Python editor or a field.
document.addEventListener('paste', (e) => {
    const t = e.target;
    if (t && ((t.closest && t.closest('.monaco-editor')) || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const cd = e.clipboardData || window.clipboardData;
    const text = cd ? cd.getData('text') : '';
    if (importMission(text)) e.preventDefault();
});

document.getElementById('spyClose').addEventListener('click', () => {
    spyPanel.classList.remove('visible');
});

// ============================================================
// Workspace Persistence
// ============================================================

const STORAGE_KEY = 'roverWorkspace';

function saveWorkspace() {
    const state = Blockly.serialization.workspaces.save(workspace);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadWorkspace() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            const state = JSON.parse(saved);
            Blockly.serialization.workspaces.load(state, workspace);
            if (mergeUplinkHats(workspace)) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(Blockly.serialization.workspaces.save(workspace)));
                showToast('Merged extra uplinks into one mission', 'success');
            }
            return;
        } catch (e) {
            console.warn('Failed to load workspace:', e);
        }
    }
    // No saved state — start with an On uplink block
    const block = workspace.newBlock('rover_on_receive');
    block.initSvg();
    block.render();
    block.moveBy(40, 40);
}

// Save on change (debounced)
let saveTimeout;
workspace.addChangeListener(() => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveWorkspace, 500);
});

// Load on startup
loadWorkspace();

// Handle resize
window.addEventListener('resize', () => Blockly.svgResize(workspace));

// ============================================================
// PWA Service Worker Registration
// ============================================================

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/static/service-worker.js')
        .then(reg => console.log('Service worker registered'))
        .catch(err => console.warn('Service worker registration failed:', err));
}

// ============================================================
// Monaco Editor Initialization
// ============================================================

let pythonEditor;

const PYTHON_STORAGE_KEY = 'roverPythonCode';
const DEFAULT_PYTHON = [
    '# Write Python directly — rover and time are available',
    '# Examples:',
    '#   rover.forward(60)',
    '#   time.sleep(1)',
    '#   rover.stop()',
    '',
    '# Loop:',
    'for i in range(4):',
    '    rover.forward(60)',
    '    time.sleep(1)',
    '    rover.stop()',
    '    rover.spinLeft(60)',
    '    time.sleep(0.5)',
    '    rover.stop()',
].join('\n');

/**
 * Monaco is the ONE thing on this page that still needs the internet,
 * and it now degrades instead of dying.
 *
 * Blockly is served locally (see /static/vendor/blockly), but Monaco is
 * 24MB unpacked, which does not belong in a git repository that gets
 * pulled onto a Raspberry Pi. So the Python tab falls back to a plain
 * textarea when the CDN is unreachable: no syntax highlighting, but a
 * child can still read, edit and send their code with no connection at
 * all. A blank pane would have been the alternative.
 *
 * Everything downstream calls getValue/setValue, so the fallback offers
 * exactly those and nothing else has to know which one it got.
 */
const savedPython = localStorage.getItem(PYTHON_STORAGE_KEY) || DEFAULT_PYTHON;

function persistPython(value) {
    localStorage.setItem(PYTHON_STORAGE_KEY, value);
}

function createPlainEditor(initialValue, reason) {
    const host = document.getElementById('pythonEditor');
    host.innerHTML = '';

    const note = document.createElement('p');
    note.className = 'python-fallback-note';
    note.textContent = 'Offline: plain text editor. Your code still runs.';
    host.appendChild(note);

    const area = document.createElement('textarea');
    area.className = 'python-fallback';
    area.spellcheck = false;
    area.value = initialValue;
    host.appendChild(area);

    let saveTimer;
    area.addEventListener('input', () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => persistPython(area.value), 500);
    });

    console.warn('Monaco unavailable (' + reason + '); using the plain editor.');
    return {
        getValue: () => area.value,
        setValue: (value) => {
            area.value = value;
            persistPython(value);
        },
    };
}

function createMonacoEditor() {
    pythonEditor = monaco.editor.create(document.getElementById('pythonEditor'), {
        value: savedPython,
        language: 'python',
        theme: 'vs-dark',
        fontSize: 14,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 4,
        insertSpaces: true,
    });

    // Save on change (debounced) — mirrors the Blockly persistence
    let pySaveTimeout;
    pythonEditor.onDidChangeModelContent(() => {
        clearTimeout(pySaveTimeout);
        pySaveTimeout = setTimeout(() => persistPython(pythonEditor.getValue()), 500);
    });
}

if (typeof require === 'undefined') {
    // loader.js itself never arrived, so there is nothing to ask.
    pythonEditor = createPlainEditor(savedPython, 'loader.js did not load');
} else {
    // A timer as well as an error callback: a CDN that accepts the
    // connection and then stalls leaves require's errback unfired, and
    // a child would sit in front of an empty pane indefinitely.
    let settled = false;
    const giveUp = setTimeout(() => {
        if (settled) return;
        settled = true;
        pythonEditor = createPlainEditor(savedPython, 'timed out');
    }, 8000);

    require.config({ paths: { vs: 'https://unpkg.com/monaco-editor@0.52.0/min/vs' } });
    require(
        ['vs/editor/editor.main'],
        function () {
            if (settled) return;
            settled = true;
            clearTimeout(giveUp);
            createMonacoEditor();
        },
        function (error) {
            if (settled) return;
            settled = true;
            clearTimeout(giveUp);
            pythonEditor = createPlainEditor(savedPython, String(error));
        },
    );
}
