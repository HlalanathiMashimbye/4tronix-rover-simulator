// --- Camera control ------------------------------------------------
// The camera runs as a separate process; starting it used to mean SSH
// and a terminal, which at an event means finding a laptop.
const camStart = document.getElementById('camera-start');
const camStop = document.getElementById('camera-stop');
const camMsg = document.getElementById('camera-msg');
const camManaged = document.getElementById('camera-managed');

// Sticky until the operator acts again. The refresh that runs after a
// failed start used to overwrite the real reason with the generic
// "not running" hint a moment later, so the actionable message
// flashed and vanished and the button looked like it did nothing.
let camMsgIsError = false;

function setCamMsg(text, tone) {
    camMsg.textContent = text || '';
    if (tone) camMsg.dataset.tone = tone; else delete camMsg.dataset.tone;
    camMsgIsError = tone === 'bad';
    // The panel only exists while there is something to read. An empty
    // strip under the camera row is a row of nothing pretending to be
    // a row of something.
    const panel = document.getElementById('camera-msg-panel');
    if (panel) panel.hidden = !text;
}

async function cameraAction(path, body) {
    camStart.disabled = camStop.disabled = true;
    setCamMsg('Working\u2026');
    try {
        const resp = await fetch(`/operator/api/camera/${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {}),
        });
        const data = await resp.json().catch(() => ({}));
        // No 401 branch: camera control is not behind a login either.
        if (!resp.ok) throw new Error(data.error || `Failed (HTTP ${resp.status})`);
        camMsgIsError = false;

        // The server needs a moment to bind its port, so confirm by
        // polling rather than claiming success the request cannot know.
        setCamMsg('Waiting for the camera to come up\u2026');
        for (let i = 0; i < 12; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const st = await fetch('/operator/api/camera').then(r => r.json()).catch(() => ({}));
            if (st.listening) { setCamMsg('Camera is up.', 'ok'); YardStatus.refreshNow(); return; }
        }
        setCamMsg('Started, but the feed has not come up yet. Check the camera is plugged in.', 'bad');
    } catch (e) {
        setCamMsg(e.message || 'Could not reach the satellite.', 'bad');
    } finally {
        camStart.disabled = camStop.disabled = false;
        // loadCamera() used to live here. The card paints from the
        // shared status now, so ask that to refresh instead - calling
        // the old name was a ReferenceError nothing caught.
        YardStatus.refreshNow();
    }
}

// A Mac has several cameras - built-in, Continuity Camera, Desk View -
// so it gets a list of them by name (David's MacBook mode had this on
// /status). Everywhere else there is nothing to choose and nothing is
// shown: Start restarts whichever camera the satellite already uses.
const camSource = document.getElementById('camera-source');
const camSourceLabel = document.querySelector('label[for="camera-source"]');
// Last index the status reported, so a list that arrives after it
// still opens on the right name.
let camCurrentIndex = null;

camStart.onclick = () => cameraAction('start',
    camSource.hidden ? {} : { cameraIndex: Number(camSource.value) });

function paintDevices(data) {
    if (!data || !data.available || !data.devices || !data.devices.length) return;
    // Built as elements, never as an HTML string: the names come from
    // whatever is plugged in.
    camSource.replaceChildren(...data.devices.map((d) => {
        const opt = document.createElement('option');
        opt.value = String(d.index);
        opt.textContent = d.name;
        return opt;
    }));
    if (camCurrentIndex !== null) camSource.value = String(camCurrentIndex);
    camSource.hidden = false;
    camSourceLabel.hidden = false;
}

camSource.onchange = () => {
    cameraAction('start', { cameraIndex: Number(camSource.value) });
};

// Once, not on the status clock: cameras are rarely plugged in while
// the page is open, and a reload picks up the ones that are.
fetch('/operator/api/camera/devices')
    .then((r) => r.json())
    .then(paintDevices)
    .catch(() => {});
camStop.onclick = () => cameraAction('stop');

// Painted from the shared status, not from a poll of its own.
//
// This had its own fetch of /operator/api/camera on a 30s timer, while
// the run station polled /api/status every 5s and probed readiness
// separately. Two pages, two clocks, two answers about one camera -
// which is exactly how you get a Settings page insisting the camera is
// fine while the run station refuses to record.
function paintCamera(cam) {
    if (!cam) return;
    if (typeof cam.cameraIndex === 'number') {
        camCurrentIndex = cam.cameraIndex;
        if (!camSource.hidden) camSource.value = String(cam.cameraIndex);
    }
    camStart.textContent = cam.listening ? 'Restart camera' : 'Start camera';
    camStop.hidden = !cam.listening;
    // Worth showing: on the Pi systemd owns the lifecycle and will
    // restart the camera by itself, so a stopped feed there means
    // something else is wrong.
    camManaged.textContent = cam.managedBy === 'systemd'
        ? 'managed by systemd' : 'managed by this console';
    // Never replace a specific failure with the generic hint.
    if (!cam.listening && cam.hint && !camMsgIsError) setCamMsg(cam.hint);
    // Listening but producing nothing is its own state, and the one
    // that decides whether a run can be recorded. It used to be
    // invisible here: the card said the camera was up.
    if (cam.listening && !cam.ready && !camMsgIsError) {
        setCamMsg('Camera is running but no frames are arriving' +
                  (cam.detail ? ' (' + cam.detail + ')' : '') + '.', 'bad');
    }
}
YardStatus.subscribe((data) => paintCamera(data.camera));



// --- Console and camera tunables -------------------------------
// Same shape as the sync card above. These were environment
// variables until they moved here; the server keeps the old vars as
// defaults, so an untouched satellite behaves exactly as before.
// cameraHost is deliberately absent. It has exactly one correct value
// on a real yard - the camera and this server are the same Pi - and its
// only other use is running web_server on a laptop against the Pi's
// camera, which is a developer convenience, not something an operator
// should meet on a page they use under pressure. It stays as the
// CAMERA_HOST environment variable.
const TUNABLE_FIELDS = {
    cameraReadyTimeout: 'tunCameraReady',
    recordingTail: 'tunRecordingTail',
};

const CLEANUP_FIELDS = {
    cleanupGracePeriod: 'tunGracePeriod',
    cleanupMaxAge: 'tunMaxAge',
    cleanupMinFreeGB: 'tunMinFreeGB',
};

const RECORDING_FIELDS = {
    yardClosesAt: 'tunClosesAt',
};

// Picture quality is a choice, not a number, so it renders as buttons
// and saves on click. It is also the one tunable that does NOT take
// effect on next use: the camera reads its resolution when it starts,
// so changing it restarts the camera. Doing that silently is the whole
// point - an operator picking "Sharper" means the picture, not a
// two-step procedure ending in a button labelled Start camera.
let resolutionChoice = null;

function paintResolution(options, current) {
    const box = document.getElementById('tunResolution');
    if (!box || !options) return;
    resolutionChoice = current;
    // The dimensions carry the 4:3 on their face - 640 x 480, 1280 x 960
    // - so a sentence saying "the camera is 4:3 at every setting" was
    // grey prose repeating what the buttons already show. The title is
    // there for anyone who wants it spelled out.
    box.innerHTML = options.values.map((v, i) =>
        `<button type="button" role="radio" data-value="${v}"` +
        ` title="${v.replace('x', ' by ')}, 4:3 like the camera"` +
        ` aria-checked="${v === current}">${options.labels[i]}` +
        `<span class="seg-dim">${v.replace('x', ' \u00d7 ')}</span></button>`
    ).join('');
    box.querySelectorAll('button').forEach((b) => {
        b.addEventListener('click', () => chooseResolution(b.dataset.value));
    });
}

// The one setting that was always instant, now saying so the same way
// the rest of the card does. Its message is its own, though: this is
// the only tunable that does not take effect on the next use but
// needs the camera taken down and brought back up.
async function chooseResolution(value) {
    if (value === resolutionChoice) return;
    const before = resolutionChoice;
    paintResolution(lastResolutionOptions, value);
    setStatus(tunMsg, 'Saving and restarting the camera\u2026');
    try {
        const resp = await fetch('/operator/api/config/tunables', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cameraResolution: value }),
        });
        if (!resp.ok) throw new Error('save failed');
        // The camera only reads this at startup, so the setting is not
        // real until it has been through one.
        await fetch('/operator/api/camera/start', { method: 'POST' });
        flashSaved(document.getElementById('tunResolution'));
        setStatus(tunMsg, 'Saved. The camera is restarting at the new quality.', 'ok', 6000);
    } catch (e) {
        paintResolution(lastResolutionOptions, before);
        setStatus(tunMsg, 'Could not change the quality. The camera is unchanged.', 'bad');
    }
}

let lastResolutionOptions = null;
const tunMsg = document.getElementById('tunMsg');

// Which way up is a choice too, and unlike picture quality it needs
// no restart: the camera asks which way up on its way to each frame,
// so the picture turns within a second of the click.
let rotationChoice = null;
let lastRotationOptions = null;

function paintRotation(options, current) {
    const box = document.getElementById('tunRotation');
    if (!box || !options) return;
    rotationChoice = current;
    box.innerHTML = '';
    options.values.forEach((value, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.dataset.value = value;
        b.setAttribute('aria-checked', String(value === current));
        b.textContent = options.labels[i];
        b.addEventListener('click', () => chooseRotation(value));
        box.appendChild(b);
    });
}

async function chooseRotation(value) {
    if (value === rotationChoice) return;
    const before = rotationChoice;
    paintRotation(lastRotationOptions, value);
    setStatus(tunMsg, 'Saving\u2026');
    try {
        const resp = await fetch('/operator/api/config/tunables', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cameraRotation: value }),
        });
        if (!resp.ok) throw new Error('save failed');
        flashSaved(document.getElementById('tunRotation'));
        setStatus(tunMsg, 'Saved. The picture turns within a second.', 'ok', 6000);
    } catch (e) {
        paintRotation(lastRotationOptions, before);
        setStatus(tunMsg, 'Could not turn the picture. It is as it was.', 'bad');
    }
}

// Each slider's own readout, since a range input shows no number on
// its own. Kept in sync on every drag and every time something
// programmatic sets .value (page load, a save's repaint) - a range
// input fires no 'input' event for the latter, so those call sites
// call this directly rather than relying on the listener alone.
const camReadySlider = document.getElementById('tunCameraReady');
const sliders = [...document.querySelectorAll('.slider-row input[type="range"]')];
function syncSliderVals() {
    for (const slider of sliders) {
        const readout = document.getElementById(slider.id + 'Val');
        if (readout) readout.textContent = Number(slider.value).toFixed(1) + 's';
    }
}
sliders.forEach((slider) => slider.addEventListener('input', syncSliderVals));

async function loadTunables() {
    try {
        const resp = await fetch('/operator/api/config/tunables');
        if (!resp.ok) return;
        const d = await resp.json();
        for (const [name, id] of Object.entries(TUNABLE_FIELDS)) {
            const el = document.getElementById(id);
            if (el && d.values[name] !== undefined) el.value = d.values[name];
        }
        for (const [name, id] of Object.entries({ ...CLEANUP_FIELDS, ...RECORDING_FIELDS })) {
            const el = document.getElementById(id);
            if (el && d.values[name] !== undefined) el.value = d.values[name];
        }
        paintUploadSummary();
        syncSliderVals();
        // A range input silently clamps what it DISPLAYS, so a value
        // set before this slider existed, or through the API, shows
        // as 5.0s over a yard that is really waiting 7.5. Say the
        // real number instead of letting the control lie about it;
        // the next drag brings it into the slider's range for good.
        const inForce = d.values.cameraReadyTimeout;
        if (camReadySlider && inForce !== undefined
                && Number(inForce) > Number(camReadySlider.max)) {
            setStatus(tunMsg, `In force: ${inForce}s. This slider stops at ${camReadySlider.max}s.`, 'warn');
        }
        lastResolutionOptions = (d.options || {}).cameraResolution || null;
        paintResolution(lastResolutionOptions, d.values.cameraResolution);
        lastRotationOptions = (d.options || {}).cameraRotation || null;
        paintRotation(lastRotationOptions, d.values.cameraRotation);
    } catch (e) { /* offline: leave the fields as they are */ }
}

// ---- Every setting commits itself -----------------------------
//
// There is no Save button on this page, because a Save button could
// not answer the question an operator actually has. It looked the
// same whether or not anything was pending, so "have I saved this?"
// had no answer on screen, and the honest one was "press it again
// and see". Picture quality never had that problem: it saved on
// click and said so. Everything here works that way now.
//
// The feedback is what the button was standing in for, and it is in
// two places on purpose: the field flashes, because the card's line
// cannot say which of three numbers took, and the card writes a
// line, because a flash cannot say "adjusted to 16" or why a save
// failed.
function setStatus(el, text, tone, clearAfter) {
    if (!el) return;
    el.textContent = text || '';
    if (tone) { el.dataset.tone = tone; } else { delete el.dataset.tone; }
    clearTimeout(el._statusTimer);
    if (clearAfter) {
        el._statusTimer = setTimeout(() => {
            el.textContent = '';
            delete el.dataset.tone;
        }, clearAfter);
    }
}

function flashSaved(el) {
    if (!el) return;
    clearTimeout(el._flashTimer);
    el.classList.add('just-saved');
    el._flashTimer = setTimeout(() => el.classList.remove('just-saved'), 1400);
}

// The field's own frame, which is what carries the flash: the number
// boxes and the slider all sit inside one of these, and a range
// input styled down to a bare track has no border of its own to
// light up.
function frameOf(el) { return el.closest('.sync-input-row') || el; }

// Latest write wins, per field. Two saves of the same setting can be
// in flight when someone drags the slider, lets go, and drags again
// inside the debounce; without this the older response can land last
// and repaint the field to a value the operator has already moved on
// from.
const saveSeq = new Map();
const saveTimers = new Map();
const SAVE_DEBOUNCE_MS = 400;

async function commit(name, el, statusEl) {
    // The closing time is a time of day; everything else is a number.
    const value = el.type === 'time' ? el.value : Number(el.value);
    const seq = (saveSeq.get(name) || 0) + 1;
    saveSeq.set(name, seq);
    setStatus(statusEl, 'Saving\u2026');
    try {
        const resp = await fetch('/operator/api/config/tunables', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [name]: value }),
        });
        const d = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(d.error || `Failed (HTTP ${resp.status})`);
        if (saveSeq.get(name) !== seq) return;   // a newer save already went out

        // Repaint from the response. The server clamps, so what was
        // typed is not always what is in force, and a number left on
        // screen that is true nowhere else is worse than no number.
        const inForce = (d.values || {})[name];
        const adjusted = inForce !== undefined && String(inForce) !== String(value);
        if (inForce !== undefined) { el.value = inForce; syncSliderVals(); }
        frameOf(el).classList.remove('save-failed');
        flashSaved(frameOf(el));
        setStatus(statusEl,
                  adjusted ? `Saved, adjusted to ${inForce}` : 'Saved',
                  'ok', 4000);
    } catch (e) {
        if (saveSeq.get(name) !== seq) return;
        // The field keeps the mark until it saves, because the number
        // on screen is now true nowhere else, and neither the message
        // nor the mark may be on a timer: one that cleared itself
        // would leave the operator believing it went through.
        frameOf(el).classList.add('save-failed');
        setStatus(statusEl, e.message || 'Could not save', 'bad');
    }
}

function wireAutoSave(fields, statusEl) {
    for (const [name, id] of Object.entries(fields)) {
        const el = document.getElementById(id);
        if (!el) continue;
        // 'change', not 'input': a number box commits on blur or
        // Enter and the slider on release, so the "7" on the way to
        // "72" is never sent and then clamped to something nobody
        // asked for. The debounce behind it folds a burst of
        // arrow-key nudges into one request.
        el.addEventListener('change', () => {
            clearTimeout(saveTimers.get(name));
            saveTimers.set(name, setTimeout(() => commit(name, el, statusEl), SAVE_DEBOUNCE_MS));
        });
    }
}
wireAutoSave(TUNABLE_FIELDS, tunMsg);
wireAutoSave(CLEANUP_FIELDS, document.getElementById('cleanupMsg'));
wireAutoSave(RECORDING_FIELDS, document.getElementById('closesMsg'));
document.getElementById('tunClosesAt').addEventListener('change', () => paintUploadSummary());

loadTunables();

// --- Recordings ------------------------------------------------
// Downloads come off the satellite over the LAN, which is the whole
// point: the operator's phone is on the venue's wifi with no route to
// the internet, and this still works.
function humanBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function humanDate(iso) {
    try {
        var d = new Date(iso);
        return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
            + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
}

function paintDiskBar(disk) {
    var wrap = document.getElementById('diskBar');
    var fill = document.getElementById('diskBarFill');
    var label = document.getElementById('diskLabel');
    if (!wrap || !disk || !disk.total_bytes) return;

    var pct = Math.round((disk.used_bytes / disk.total_bytes) * 100);
    var freeGB = (disk.free_bytes / (1024 * 1024 * 1024)).toFixed(1);
    var totalGB = (disk.total_bytes / (1024 * 1024 * 1024)).toFixed(0);

    fill.style.width = pct + '%';
    if (pct >= 90) fill.dataset.tone = 'bad';
    else if (pct >= 75) fill.dataset.tone = 'warn';
    else delete fill.dataset.tone;

    label.textContent = freeGB + ' GB free of ' + totalGB + ' GB';
    wrap.hidden = false;
}

var recSortOrder = 'newest';
var recData = [];

document.getElementById('recSort').addEventListener('change', function () {
    recSortOrder = this.value;
    paintRecordings();
});

function updateDeleteBar() {
    var checks = document.querySelectorAll('.rec-check:checked');
    var bar = document.getElementById('recDeleteBar');
    var countEl = document.getElementById('recDeleteCount');
    var n = checks.length;
    bar.hidden = n === 0;
    countEl.textContent = n === 1 ? '1 recording selected' : n + ' recordings selected';
}

document.getElementById('recSelectAll').addEventListener('change', function () {
    var checked = this.checked;
    document.querySelectorAll('.rec-check').forEach(function (cb) { cb.checked = checked; });
    updateDeleteBar();
});

function paintRecordings() {
    var box = document.getElementById('recordingsList');
    var toolbar = document.getElementById('recToolbar');
    var deleteBar = document.getElementById('recDeleteBar');
    var selectAll = document.getElementById('recSelectAll');
    var result = document.getElementById('recResult');
    if (!box) return;

    result.hidden = true;
    // Kept across a repaint: the list now redraws itself while videos
    // upload, and a selection made for deleting must survive that.
    var keep = {};
    document.querySelectorAll('.rec-check:checked').forEach(function (cb) { keep[cb.dataset.name] = true; });
    selectAll.checked = false;

    if (!recData.length) {
        toolbar.hidden = true;
        deleteBar.hidden = true;
        box.innerHTML = '<div class="kv"><span class="k">Nothing recorded yet</span></div>';
        return;
    }

    toolbar.hidden = false;
    var sorted = recData.slice();
    sorted.sort(function (a, b) {
        return recSortOrder === 'oldest'
            ? a.modified.localeCompare(b.modified)
            : b.modified.localeCompare(a.modified);
    });

    box.innerHTML = sorted.map(function (r) {
        // With automatic uploads, where the video has got to is the
        // question, and "not yet downloaded" is noise: only a
        // download actually made is still worth saying.
        var badge = r.upload
            ? uploadBadge(r.upload) + (r.downloaded ? '<span class="dl-badge yes">downloaded</span>' : '')
            : (r.downloaded
                ? '<span class="dl-badge yes">downloaded</span>'
                : '<span class="dl-badge no">not yet</span>');
        var bar = r.upload && r.upload.state === 'sending'
            ? '<span class="up-bar"><span style="width:' + Number(r.upload.percent || 0) + '%"></span></span>'
            : '';
        return '<div class="rec-row">'
            + '<input type="checkbox" class="rec-check" data-name="' + r.name.replace(/"/g, '&quot;') + '"' + (keep[r.name] ? ' checked' : '') + '>'
            + '<div class="rec-info">'
            + '<a class="rec-name" download href="/api/recordings/' + encodeURIComponent(r.name) + '">' + r.name + '</a>'
            + '<div class="rec-meta">'
            + humanDate(r.modified) + ' &middot; ' + humanBytes(r.bytes) + ' ' + badge
            + '</div>' + bar + '</div></div>';
    }).join('');
    var allBoxes = box.querySelectorAll('.rec-check');
    selectAll.checked = allBoxes.length > 0 && box.querySelectorAll('.rec-check:checked').length === allBoxes.length;

    box.querySelectorAll('.rec-check').forEach(function (cb) {
        cb.addEventListener('change', function () {
            updateDeleteBar();
            var all = document.querySelectorAll('.rec-check');
            var checked = document.querySelectorAll('.rec-check:checked');
            selectAll.checked = all.length > 0 && all.length === checked.length;
        });
    });
    updateDeleteBar();
}

// ---- Uploads ----------------------------------------------------
// Why a manual one is manual, in the operator's words.
var MANUAL_REASONS = {
    'too-large': 'too big to send',
    'max-attempts': 'YouTube refused it',
    'not-configured': 'uploads not set up',
    'HTTP 401': 'not allowed',
};

function uploadBadge(u) {
    if (u.state === 'uploaded' && u.url) {
        return '<a class="up-badge uploaded" href="' + encodeURI(u.url) + '" target="_blank" rel="noopener noreferrer">On YouTube '
            + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg></a>';
    }
    if (u.state === 'uploaded') return '<span class="up-badge uploaded">On YouTube</span>';
    if (u.state === 'sending') return '<span class="up-badge sending">Uploading ' + Number(u.percent || 0) + '%</span>';
    if (u.state === 'manual') {
        var why = MANUAL_REASONS[u.reason] || 'could not upload';
        return '<span class="up-badge">Upload by hand &middot; ' + why + '</span>';
    }
    return '<span class="up-badge waiting">' + (lastUploads && lastUploads.online === false ? 'Waiting for internet' : 'Waiting to upload') + '</span>';
}

var lastUploads = null;
var lastUploadsKey = '';

function isToday(iso) {
    var d = new Date(iso), now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function minutesUntilClose() {
    var value = document.getElementById('tunClosesAt').value || '16:30';
    var parts = value.split(':');
    var close = new Date();
    close.setHours(Number(parts[0]), Number(parts[1]), 0, 0);
    return Math.round((close - new Date()) / 60000);
}

function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

function paintUploadSummary() {
    var summary = document.getElementById('upSummary');
    var closing = document.getElementById('upClosing');
    var u = lastUploads;
    if (!u || !u.configured) {
        summary.hidden = true;
        closing.hidden = true;
        return;
    }
    summary.hidden = false;

    var today = recData.filter(function (r) { return r.upload && isToday(r.modified); });
    var count = function (state) { return today.filter(function (r) { return r.upload.state === state; }).length; };
    var parts = [];
    if (count('uploaded')) parts.push(count('uploaded') + ' on YouTube');
    if (count('sending')) parts.push(count('sending') + ' uploading');
    if (count('waiting')) parts.push(count('waiting') + ' waiting');
    if (count('manual')) parts.push(count('manual') + ' by hand');
    document.getElementById('upTally').textContent = parts.length
        ? 'Today: ' + parts.join(', ')
        : 'No videos today yet';

    var online = document.getElementById('upOnline');
    online.hidden = u.online === null || u.online === undefined;
    online.dataset.tone = u.online ? 'ok' : 'warn';
    online.textContent = u.online ? 'Online' : 'No internet';

    var left = minutesUntilClose();
    document.getElementById('upCountdown').textContent = left > 0
        ? '\u00b7 ' + (left >= 60 ? Math.floor(left / 60) + ' h ' + (left % 60) + ' min' : left + ' min')
        : '\u00b7 closed';

    // Quiet for most of the day. From half an hour before closing it
    // answers the question the operator has then: can I switch it off?
    var waiting = u.waiting || 0;
    if (left > 30 || (!today.length && !waiting)) {
        closing.hidden = true;
        return;
    }
    var text, tone;
    if (u.sending) {
        tone = 'info';
        text = 'A video is uploading now. Leave the satellite on until it finishes, or switch off and it goes up next time the satellite is online.';
    } else if (waiting) {
        tone = 'warn';
        text = plural(waiting, "video hasn't", "videos haven't") + ' gone up. Safe to switch off: they go up by themselves next time the satellite is online.';
    } else {
        tone = 'ok';
        text = "Everything from today is on YouTube. Safe to switch off.";
    }
    if (count('manual')) text += ' ' + plural(count('manual'), 'needs', 'need') + ' uploading by hand.';
    closing.dataset.tone = tone;
    closing.textContent = text;
    closing.hidden = false;
}

if (window.YardStatus) {
    YardStatus.subscribe(function (data) {
        lastUploads = data.uploads || null;
        // The list redraws when something it shows has moved, not on
        // every poll: a waiting count, a settled video, a percent.
        var u = lastUploads || {};
        var key = [u.waiting, u.uploaded, u.manual, u.online,
                   u.sending ? u.sending.recording + Math.floor(100 * u.sending.sent / u.sending.total / 5) : ''].join('|');
        if (key !== lastUploadsKey) {
            lastUploadsKey = key;
            if (u.configured) loadRecordings();
        }
        paintUploadSummary();
    });
}
setInterval(paintUploadSummary, 30000);

async function loadRecordings() {
    var box = document.getElementById('recordingsList');
    if (!box) return;
    try {
        var resp = await fetch('/api/recordings');
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var data = await resp.json();
        recData = data.recordings || [];
        paintDiskBar(data.disk);
        paintRecordings();
        paintUploadSummary();
    } catch (e) {
        box.innerHTML = '<div class="kv"><span class="k">Could not read recordings</span></div>';
    }
}

function showRecResult(text, tone) {
    var el = document.getElementById('recResult');
    el.textContent = text;
    el.className = 'rec-result';
    el.dataset.tone = tone;
    el.hidden = false;
    setTimeout(function () { el.hidden = true; }, 6000);
}

// ---- Shut down ------------------------------------------------------
// The satellite used to go off at the plug, which on 17 October left
// every file a git pull had just written empty, and leaves a recording
// still open unplayable. This is the clean way, from the page that is
// already open. What it does is satellite_power.py.
(function () {
    var btn = document.getElementById('powerBtn');
    var power = { canPowerOff: false, detail: '' };

    fetch('/operator/api/satellite/power').then(function (r) { return r.json(); }).then(function (d) {
        power = d;
        btn.dataset.ready = d.canPowerOff ? 'true' : 'false';
        btn.title = d.canPowerOff ? 'Shut down the satellite' : 'Shutting down needs a one-time setup';
    }).catch(function () { btn.dataset.ready = 'false'; });

    function dialog(title, lines, actions) {
        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'powerDialog';
        var box = document.createElement('div');
        box.className = 'modal';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        var h = document.createElement('h2');
        h.textContent = title;
        box.appendChild(h);
        lines.forEach(function (line) { box.appendChild(line); });
        if (actions.length) {
            var row = document.createElement('div');
            row.className = 'modal-actions';
            actions.forEach(function (a) { row.appendChild(a); });
            box.appendChild(row);
        }
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        return overlay;
    }
    function para(text, cls) {
        var p = document.createElement(cls === 'power-cmd' ? 'code' : 'p');
        if (cls) p.className = cls;
        p.textContent = text;
        return p;
    }
    function button(label, cls, onClick) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn' + (cls ? ' ' + cls : '');
        b.textContent = label;
        b.addEventListener('click', onClick);
        return b;
    }

    btn.addEventListener('click', function () {
        if (!power.canPowerOff) {
            var lines = [para('Someone with the mars password runs this once on the Pi, and from then on this button works:'),
                         para('sudo bash yard/docs/setup-scripts/satellite-sudoers.sh', 'power-cmd')];
            var notSetUp = dialog('Shutting down needs a one-time setup', lines, [
                button('Close', '', function () { notSetUp.remove(); }),
            ]);
            return;
        }

        var latest = window.YardStatus && YardStatus.latest();
        var filming = (latest && latest.recording && latest.recording.active) || [];
        var lines = [para("The console, the camera and the yard's wifi go off.")];
        if (filming.length) lines.push(para('A recording is running. It is stopped and kept first, so it plays.'));
        lines.push(para('To turn it back on, unplug it and plug it in again.'));
        var message = para('', 'url-error');
        lines.push(message);

        var confirm = dialog('Shut down the satellite?', lines, [
            button('Cancel', '', function () { confirm.remove(); }),
            button('Shut down', 'danger-solid', async function () {
                this.disabled = true;
                this.textContent = 'Shutting down…';
                try {
                    var resp = await fetch('/operator/api/satellite/shutdown', { method: 'POST' });
                    var data = await resp.json().catch(function () { return {}; });
                    if (!resp.ok) throw new Error(data.error || 'The satellite could not shut down.');
                    confirm.remove();
                    // The last thing this page can say: the wifi goes
                    // with the satellite, so nothing after it arrives.
                    dialog('Shutting down', [
                        para("It's safe to unplug once the Pi's green light has stopped flashing, in about 20 seconds."),
                    ], []);
                } catch (e) {
                    message.textContent = e.message;
                    this.disabled = false;
                    this.textContent = 'Shut down';
                }
            }),
        ]);
        confirm.addEventListener('click', function (e) { if (e.target === confirm) confirm.remove(); });
    });
})();

document.getElementById('recDeleteBtn').addEventListener('click', function () {
    var checked = document.querySelectorAll('.rec-check:checked');
    var names = [];
    checked.forEach(function (cb) { names.push(cb.dataset.name); });
    if (!names.length) return;

    var msg = names.length === 1
        ? 'Delete 1 recording from the SD card?'
        : 'Delete ' + names.length + ' recordings from the SD card?';

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
        '<div class="modal">' +
        '<h2>Confirm deletion</h2>' +
        '<p>' + msg + ' This cannot be undone.</p>' +
        '<div class="modal-actions">' +
        '<button class="btn" id="recConfirmCancel" type="button">Cancel</button>' +
        '<button class="btn danger" id="recConfirmDelete" type="button">Delete</button>' +
        '</div></div>';
    document.body.appendChild(overlay);

    overlay.querySelector('#recConfirmCancel').addEventListener('click', function () {
        overlay.remove();
    });
    overlay.addEventListener('click', function (e) {
        if (e.target === overlay) overlay.remove();
    });

    overlay.querySelector('#recConfirmDelete').addEventListener('click', async function () {
        var btn = this;
        btn.disabled = true;
        btn.textContent = 'Deleting…';
        try {
            var resp = await fetch('/api/recordings/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ names: names }),
            });
            var data = await resp.json();
            overlay.remove();
            if (!resp.ok) {
                showRecResult(data.error || 'Delete failed', 'bad');
                return;
            }
            var nd = (data.deleted || []).length;
            var ns = (data.skipped || []).length;
            if (nd && !ns) {
                showRecResult('Deleted ' + nd + (nd === 1 ? ' recording.' : ' recordings.'), 'ok');
            } else if (nd && ns) {
                var reasons = data.skipped.map(function (s) { return s.name + ' (' + s.reason + ')'; }).join(', ');
                showRecResult('Deleted ' + nd + '. Skipped ' + ns + ': ' + reasons, 'ok');
            } else {
                var reasons = data.skipped.map(function (s) { return s.name + ' (' + s.reason + ')'; }).join(', ');
                showRecResult('Nothing deleted. Skipped: ' + reasons, 'bad');
            }
            await loadRecordings();
        } catch (e) {
            overlay.remove();
            showRecResult('Could not delete: ' + e.message, 'bad');
        }
    });
});

loadRecordings();

const BADGE_ICONS = {
    green: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    amber: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    red: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    grey: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>',
};

// green/amber/red are the icon's own vocabulary; the tile speaks in
// ok/warn/bad so the stripe and tint can be shared with the run
// station's readiness strip without either page learning the other's
// colour names.
const TILE_STATE = { green: 'ok', amber: 'warn', red: 'bad' };

function setBadge(id, state) {
    const el = document.getElementById('badge-' + id);
    const lbl = document.getElementById('label-' + id);
    const card = document.getElementById('card-' + id);
    el.className = 'stat-ic ' + state.colour;
    el.innerHTML = BADGE_ICONS[state.colour] || '';
    lbl.className = 'status-label ' + state.colour;
    lbl.textContent = state.text;
    // The row carries the state too, for the stripe. It is not a
    // tinted tile any more - three of those read as three alerts even
    // when everything was fine.
    if (card) {
        const tile = TILE_STATE[state.colour];
        if (tile) { card.dataset.state = tile; } else { delete card.dataset.state; }
    }
}

function setDetail(id, html) {
    document.getElementById('detail-' + id).innerHTML = html;
}

function row(label, value) {
    return label + ': <span>' + (value ?? '—') + '</span>  ';
}

// Mast camera line for the rover card (the rover's own camera, used by
// the Take a Picture block, distinct from the satellite stream below)
function roverCam(r) {
    const cam = r.camera;
    if (!cam) return '';
    return cam.detected
        ? '<br>Mast cam: <span style="color:var(--ok)">' + (cam.model || 'detected') + '</span>'
        : '<br>Mast cam: <span style="color:var(--bad)">not detected (reseat + reboot)</span>';
}

// Pure render step, split out from the fetch so a cached snapshot
// (read on load, see below) can paint instantly through the exact
// same path a live poll uses, with no separate "cached" rendering to
// keep in sync.
function renderStatus(data) {
    // Satellite: always green if this page loaded
    setBadge('satellite', { colour: 'green', text: 'OK' });
    setDetail('satellite',
        row('Hostname', data.satellite.hostname) +
        row('IP', data.satellite.ip)
    );

    // Keep the displayed rover URL and the simulator toggle in sync
    // with the server, whoever changed the address.
    document.getElementById('rover-url').textContent = data.rover.url;
    syncRoverConfig(data.rover.url);

    // Rover
    const r = data.rover;
    if (!r.reachable) {
        setBadge('rover', { colour: 'red', text: 'Unreachable' });
        // The address is its own row below (cat-kv) now, so this does
        // not repeat it - just says what "Unreachable" means.
        setDetail('rover', 'Not answering at this address.');
    } else if (r.status && r.status !== 'ok') {
        // Reachable but the queue processor thread is dead:
        // commands would be accepted yet never executed
        setBadge('rover', { colour: 'red', text: 'Processor stalled' });
        setDetail('rover',
            row('Driver', r.driver) + '<br>' +
            row('Queue', r.queue_size) +
            roverCam(r)
        );
    } else {
        if (r.hardware === false) {
            setBadge('rover', { colour: 'amber', text: 'Fake driver (no hardware)' });
        } else {
            setBadge('rover', { colour: 'green', text: 'OK' });
        }
        setDetail('rover',
            row('Driver', r.driver) + '<br>' +
            row('Queue', r.queue_size) +
            roverCam(r)
        );
    }

    // Camera
    const c = data.camera;
    if (c.reachable) {
        setBadge('camera', { colour: 'green', text: 'OK' });
        setDetail('camera', row('Port', c.port));
    } else {
        setBadge('camera', { colour: 'red', text: 'Port closed' });
        setDetail('camera', row('Port', c.port) + '(service not running?)');
    }
}

let consecutiveFailures = 0;

// The footer speaks only when something is wrong.
//
// It used to report "Last checked: 16:13:05" on a perfectly healthy
// page, which is a timestamp nobody reads telling them nothing is the
// matter - and worse, it trains the eye to skip a line that does carry
// the failures. Every card above already shows its own state, and the
// nav has a live rover chip.
function setFooter(text) {
    const el = document.getElementById('footer');
    el.textContent = text || '';
    el.hidden = !text;
}

YardStatus.subscribe((data, meta) => {
    renderStatus(data);
    if (meta && meta.cached) {
        const age = Math.round((Date.now() - meta.ts) / 1000);
        setFooter('Showing cached status (' + age + 's old), refreshing...');
    } else {
        consecutiveFailures = 0;
        setFooter('');
    }
});

YardStatus.onError(() => {
    // Exponential backoff (handled by the poller) means retries
    // space out on their own; surface that instead of implying
    // we're hammering the satellite every 5s regardless.
    consecutiveFailures++;
    setFooter(consecutiveFailures > 1
        ? 'Fetch failed (' + consecutiveFailures + ' in a row), backing off and retrying...'
        : 'Fetch failed, retrying...');
});

const urlInput = document.getElementById('url-input');
const urlError = document.getElementById('url-error');


// "Clear local cache" used to live next to this. It predates the
// shared YardCache poller, whose cached snapshots now expire and
// refresh on their own - so all the button did was reload the page
// with extra steps, and it is gone.
document.getElementById('refreshBtn').addEventListener('click', function (ev) {
    var btn = ev.currentTarget;
    btn.disabled = true;
    Promise.allSettled([YardStatus.refreshNow(), loadRecordings()])
        .then(function () { btn.disabled = false; });
});

// ---- Pointing at a rover ---------------------------------------
// Three flat controls in the order they are reached for: flip to the
// simulator, find the real rover, type an address. This replaces an
// editor that expanded out of the status row - a list, a toggle-away
// address box and a Cancel button all behind a button called Change,
// for what is really one small decision.
const SIM_URL = 'http://localhost:8523';
const findMsg = document.getElementById('findMsg');
const findBtn = document.getElementById('findRoverBtn');
const simToggle = document.getElementById('simToggle');
// Where "off" goes back to. localStorage because it is a convenience,
// not state: with nothing remembered the toggle falls back to a find.
const LAST_REAL_KEY = 'yard:lastRealRover';

function currentRoverUrl() {
    return document.getElementById('rover-url').textContent.trim();
}

function isLocal(url) {
    // Host, not substring: an address that merely mentions localhost
    // somewhere is not the simulator.
    try {
        const host = new URL(url).hostname;
        return host === 'localhost' || host === '127.0.0.1';
    } catch (e) { return false; }
}

function shortAddress(url) {
    return url.replace(/^https?:\/\//, '').replace(/:8523$/, '');
}

// The toggle mirrors the saved address, whoever changed it - this
// page, another tab, or the config file. Called from renderStatus.
function syncRoverConfig(url) {
    simToggle.checked = isLocal(url);
    if (!isLocal(url)) {
        try { localStorage.setItem(LAST_REAL_KEY, url); } catch (e) { /* convenience only */ }
    }
}

simToggle.addEventListener('change', async () => {
    findMsg.dataset.tone = '';
    if (simToggle.checked) {
        // Deliberate flip to the stand-in, so no reachability veto:
        // the simulator lives on this satellite and starts on demand.
        findMsg.textContent = 'Switching to the simulator\u2026';
        await saveUrl(SIM_URL, true);
        findMsg.textContent = 'Simulator. Nothing moves.';
    } else {
        let last = null;
        try { last = localStorage.getItem(LAST_REAL_KEY); } catch (e) { /* fall through */ }
        if (last && !isLocal(last)) {
            findMsg.textContent = 'Back to ' + shortAddress(last);
            await saveUrl(last, false);
        } else {
            // Never seen a real rover from this browser: go find one.
            await findRover();
        }
    }
    syncRoverConfig(currentRoverUrl());
});

let searchSeq = 0;
async function findRover() {
    // A repeat press starts a new search; a slower earlier one must
    // not land on top of it.
    const seq = ++searchSeq;
    findBtn.disabled = true;
    findMsg.dataset.tone = '';
    findMsg.textContent = 'Looking for rovers\u2026';
    try {
        const d = await (await fetch('/api/rover/discover')).json();
        if (seq !== searchSeq) return;
        // Real hardware first; this satellite's own simulator is the
        // toggle's job, not a search result.
        const rovers = (d.rovers || [])
            .filter((r) => !isLocal(r.url))
            .sort((a, b) => Number(!!b.hardware) - Number(!!a.hardware));
        if (!rovers.length) {
            findMsg.dataset.tone = 'bad';
            findMsg.textContent = 'No rover answered. Is it on this network? Type its address below.';
            return;
        }
        const best = rovers[0];
        const others = rovers.length - 1;
        await saveUrl(best.url, false);
        findMsg.textContent = 'Using ' + shortAddress(best.url)
            + (others ? ` (${others} other${others === 1 ? '' : 's'} answered)` : '');
    } catch (e) {
        if (seq !== searchSeq) return;
        findMsg.dataset.tone = 'bad';
        findMsg.textContent = 'Could not search: ' + e.message;
    } finally {
        if (seq === searchSeq) findBtn.disabled = false;
    }
}

findBtn.addEventListener('click', findRover);

async function saveUrl(url, force) {
    urlError.textContent = '';
    try {
        const resp = await fetch('/api/config/rover_url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, force: !!force }),
        });
        const data = await resp.json();
        if (!resp.ok) {
            // 409 means the address is well formed but nothing is
            // there. That is the likely mistake, so it is offered as a
            // choice rather than either silently saved or flatly
            // refused - setting the address before switching the rover
            // on is legitimate.
            if (data.unreachable) {
                urlError.innerHTML = '';
                urlError.textContent = data.error + ' ';
                const anyway = document.createElement('button');
                anyway.type = 'button';
                anyway.className = 'btn';
                anyway.textContent = 'Save anyway';
                anyway.addEventListener('click', () => saveUrl(url, true));
                urlError.appendChild(anyway);
                return;
            }
            urlError.textContent = data.error || 'Save failed';
            return;
        }
        document.getElementById('rover-url').textContent = data.rover_url;
        syncRoverConfig(data.rover_url);
        if (!data.persisted) {
            urlError.textContent = 'Applied, but could not write the config file, so it resets on restart';
        }
        YardStatus.refreshNow().catch(() => {}); // jump the backoff queue after a config change instead of waiting out any backoff delay; failure is already surfaced via the footer banner
    } catch (e) {
        urlError.textContent = 'Save failed: ' + e.message;
    }
}

// --- Mission Control: address and upload secret -----------------------
// The address is a tunable like the rest: stored on this satellite and
// read on every use, so the next page links to it with no restart. The
// secret is not, and never comes back to the page: see
// youtube_upload.save_secret for why it belongs to one address.
(function () {
    const dialog = document.getElementById('mcDialog');
    const input = document.getElementById('tunMissionControl');
    const secret = document.getElementById('mcSecret');
    const state = document.getElementById('mcSecretState');
    const remove = document.getElementById('mcRemoveSecret');
    const msg = document.getElementById('mcMsg');
    const host = (url) => String(url || '').replace(/^https?:\/\//, '');

    function say(text, tone) {
        msg.textContent = text || '';
        if (tone) msg.dataset.tone = tone; else delete msg.dataset.tone;
    }

    function paintSecret(status) {
        remove.hidden = !(status && status.source === 'settings');
        if (status && status.configured) {
            state.dataset.tone = 'ok';
            state.textContent = (status.source === 'environment' ? 'Set on this satellite for ' : 'Set for ')
                + host(status.issuedFor);
        } else if (status && status.otherAddress) {
            state.dataset.tone = 'warn';
            state.textContent = 'Was for ' + host(status.issuedFor) + '. Enter it again for this address.';
        } else {
            delete state.dataset.tone;
            state.textContent = 'Not set: automatic upload is off';
        }
    }

    async function loadSecret() {
        try {
            paintSecret(await fetch('/operator/api/config/upload-secret').then((r) => r.json()));
        } catch (e) { paintSecret(null); }
    }

    document.getElementById('mcBtn').addEventListener('click', async () => {
        say('');
        secret.value = '';
        try {
            const d = await fetch('/operator/api/config/tunables').then((r) => r.json());
            input.value = (d.values || {}).missionControlUrl || '';
        } catch (e) { /* the box opens empty; Use still says what went wrong */ }
        await loadSecret();
        dialog.showModal();
        input.select();
    });
    document.getElementById('mcCancel').addEventListener('click', () => dialog.close());

    remove.addEventListener('click', async () => {
        const resp = await fetch('/operator/api/config/upload-secret', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: '' }),
        }).catch(() => null);
        if (!resp || !resp.ok) { say('Could not reach the satellite to remove it.', 'bad'); return; }
        paintSecret(await resp.json());
        say('Removed. Automatic upload is off on this satellite.', 'ok');
    });

    document.getElementById('mcForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        say('Saving…');
        try {
            // The address first: the secret is stored for whatever
            // address is in force when it is saved.
            const resp = await fetch('/operator/api/config/tunables', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ missionControlUrl: input.value }),
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) {
                say('That is not a web address. Type one like marsyard.sapient.rocks.', 'bad');
                return;
            }
            const now = data.values.missionControlUrl;
            // The bar on this page was drawn with the old address.
            document.querySelectorAll('.mc-back').forEach((link) => {
                link.href = now + '/operator';
                link.dataset.missionControl = now;
            });
            input.value = now;

            if (secret.value.trim()) {
                const sresp = await fetch('/operator/api/config/upload-secret', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ secret: secret.value }),
                });
                const sdata = await sresp.json().catch(() => ({}));
                if (!sresp.ok) {
                    await loadSecret();
                    say(sdata.error || 'That is not the upload secret.', 'bad');
                    return;
                }
                secret.value = '';
                paintSecret(sdata);
            } else {
                await loadSecret();
            }
            say('Saved. This yard now belongs to ' + host(now) + '.', 'ok');
        } catch (e) {
            say('Could not reach the satellite to save it.', 'bad');
        }
    });
})();

document.getElementById('save-url-btn').addEventListener('click', () => saveUrl(urlInput.value, false));
urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveUrl(urlInput.value, false);
});
