// Values the server renders into the page, read off this script's own tag.
const PAGE = document.currentScript.dataset;

(function () {
    const $ = (id) => document.getElementById(id);
    const missionId = $('missionId'), missionName = $('missionName'), runId = $('runId'), code = $('code');
    let recordingName = null;
    // The file this run is writing, for the notice at its end, and when the
    // satellite said it had started: only a status asked for after that can
    // say the recording has stopped.
    let recordingFile = null;
    let recordingSince = 0;
    let automaticRunRequested = false;
    let automaticRunStarted = false;
    let runListenerReady = false;

    function flash(el, text, tone) {
        el.dataset.tone = tone || '';
        el.textContent = text;
        setTimeout(() => { el.textContent = ''; el.dataset.tone = ''; }, 5000);
    }

    // ---- The fallback: import by paste --------------------------------
    // One button rather than "right-click, paste". navigator.clipboard.readText
    // needs a secure context and the yard is plain HTTP on a LAN address, so
    // the read is attempted and then falls back to a paste box rather than the
    // button simply doing nothing on the machine it matters on.
    // Mission Control's Copy button writes the mission's identity into two
    // header comments above the code. They are comments, so what it copies is
    // still exactly the Python the rover runs, and the run station can still
    // tell which mission it is looking at. Without reading these back a pasted
    // mission arrives anonymous: no name, no id, and therefore no run id - and
    // the run id is the recording's filename, so the video lands unattributable.
    const HEADER_NAME = /^[ \t]*#[ \t]*Mission:[ \t]*(.+?)[ \t]*$/m;
    const HEADER_ID = /^[ \t]*#[ \t]*MissionID:[ \t]*([A-Za-z0-9_-]+)[ \t]*$/m;
    // A flag, not the workspace. Mission Control sends "Blocks: yes" rather
    // than kilobytes of Blockly JSON, and the monitor only needs to know that
    // this mission came from blocks so it can say so on the screen.
    const HEADER_BLOCKS = /^[ \t]*#[ \t]*Blocks:[ \t]*yes[ \t]*$/mi;

    function applyImport(text) {
        text = (text || '').trim();
        if (!text) return flash($('importMsg'), 'Nothing on the clipboard', 'bad');

        if (text.startsWith('{')) {
            try {
                const parsed = JSON.parse(text);
                // Mission envelope from Mission Control carries name, id, and code.
                if (typeof parsed.code === 'string') {
                    if (parsed.missionName) setMetaValue(missionName, parsed.missionName);
                    if (parsed.missionId)   setMetaValue(missionId, parsed.missionId);
                    code.value = parsed.code;
                    $('codeDrawer').open = true;
                    updateRunIdentity();
                    paintYouTube();
                    flash($('importMsg'), 'Mission imported', 'ok');
                    return;
                }
                // A Blockly workspace is JSON. It needs the Blockly engine to
                // become Python, which lives on /code/, so hand it over there
                // rather than half-supporting it here.
                localStorage.setItem('roverWorkspace', text);
                flash($('importMsg'), 'Blocks saved. Open Code to run them.', 'ok');
                return;
            } catch (e) { /* not JSON after all, treat as Python */ }
        }
        // Python, with the identity carried in header comments.
        code.value = text;
        // The drawer opens so a fallback import is read before it is sent -
        // this path exists precisely because the normal review in Mission
        // Control did not happen.
        $('codeDrawer').open = true;
        const named = text.match(HEADER_NAME);
        const identified = text.match(HEADER_ID);
        if (named) setMetaValue(missionName, named[1]);
        if (identified) setMetaValue(missionId, identified[1]);
        // Always, not only when an id was found: this is what fills the run id
        // and the upload description, and when there is no id it is what says
        // so in the field rather than leaving a stale one from a previous run.
        updateRunIdentity();
        flash($('importMsg'),
              identified ? 'Mission imported'
                         : 'Python imported, but it has no mission ID.',
              identified ? 'ok' : '');
    }

    // ---- Getting the mission onto the page ----------------------------
    // Reading the clipboard outright needs a secure context. The yard is
    // served over plain HTTP to a tablet on the venue network, so that call is
    // absent there and cannot be made to work; the operator pastes instead.
    // Both paths end in applyImport, and neither opens a dialog.
    const pasteCatch = $('pasteCatch'), pasteBox = $('pasteBox');
    const APPLE = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
    const PASTE_KEY = APPLE ? '⌘V' : 'Ctrl-V';
    const COPY_KEY = APPLE ? '⌘C' : 'Ctrl-C';
    // A finger, not a mouse: there the gesture is a press and hold, not a key.
    const TOUCH = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

    function hidePaste() { pasteCatch.hidden = true; pasteBox.value = ''; }

    function showPaste(reason) {
        // Said for the device in hand. This station is run from a tablet as
        // often as a laptop, and the one gesture each has is different.
        pasteBox.placeholder = TOUCH ? 'Press and hold here, then tap Paste' : `Press ${PASTE_KEY}`;
        pasteCatch.hidden = false;
        pasteBox.value = '';
        pasteBox.focus();
        if (reason) flash($('importMsg'), reason, '');
    }

    $('importBtn').addEventListener('click', async () => {
        if (navigator.clipboard && navigator.clipboard.readText) {
            try {
                const text = await navigator.clipboard.readText();
                if (text && text.trim()) { hidePaste(); applyImport(text); return; }
            } catch (e) { /* refused; fall through to the paste box */ }
        }
        showPaste();
    });

    // A paste anywhere on the page is an import, so the operator who has just
    // copied in Mission Control can switch tab and paste without aiming at
    // anything. Fields the operator edits by hand are left alone. missionName
    // and missionId are read-only, so they are not in this list.
    const TYPED_FIELDS = ['code', 'ytDesc'];
    document.addEventListener('paste', (e) => {
        if (e.target && TYPED_FIELDS.includes(e.target.id)) return;
        const text = ((e.clipboardData || window.clipboardData) || {}).getData
            ? (e.clipboardData || window.clipboardData).getData('text') : '';
        if (!text || !text.trim()) return;
        e.preventDefault();
        hidePaste();
        applyImport(text);
    });

    // ---- The description that links the upload ------------------------
    // "MissionID: <id>" and "Yard: <id>" are both matched literally by the
    // auto-linker, so they are built here rather than typed by hand at the
    // end of a long day.
    //
    // The yard line is not decoration. A mission can be run at more than one
    // yard, and the linker has to attach this video to the run that produced
    // it. Given only a mission id it falls back to guessing - the most recent
    // completed run without a video - which is right until two yards run the
    // same mission on the same evening, and then it silently swaps their
    // footage. Naming the yard is what removes the guess.
    const YARD_ID = PAGE.yardId;

    // Automatic Route hands off through the application URL, never through the
    // clipboard. The yard identity is checked again here so a console opened
    // for the wrong yard cannot run a mission against this rover.
    const handoff = new URLSearchParams(window.location.search);
    if (handoff.get('handoff') === 'automatic') {
        if (handoff.get('yardId') !== YARD_ID) {
            flash($('runMsg'), 'This mission belongs to a different yard.', 'bad');
        } else if (handoff.get('code')) {
            setMetaValue(missionId, handoff.get('missionId') || '');
            setMetaValue(missionName, handoff.get('missionName') || '');
            code.value = handoff.get('code') || '';
            updateRunIdentity();
            automaticRunRequested = true;
        }
    }

    function paintYouTube() {
        const id = metaValue(missionId);
        const name = metaValue(missionName) || 'Rover mission';
        $('ytTitle').value = `${name} · Mars Yard rover run`;
        $('ytDesc').value = id
            ? `${name}, driven by a real rover at the Mars Yard.\n\nMissionID: ${id}\nYard: ${YARD_ID}`
            : 'Fill in the Mission ID above and this becomes the description to paste.';
    }
    function metaValue(element) {
        const value = ('value' in element ? element.value : element.textContent).trim();
        // '-' is the empty placeholder the fields render with. Reading it back
        // as a value put "- · Mars Yard rover run" in the YouTube title and a
        // literal "MissionID: -" in the description before anything was
        // imported.
        return value === '-' ? '' : value;
    }
    function setMetaValue(element, value) {
        if ('value' in element) {
            element.value = value;
        } else {
            element.textContent = value;
        }
    }

    // One run per yard, so the mission and the yard together identify the run
    // exactly - and that pair is the start of what recording_control names the
    // file, <mission>__<yard>__<UTC stamp>.mp4. Showing it here is not a
    // second identifier, it is the one the operator will recognise on the
    // video they download.
    function updateRunIdentity() {
        const id = metaValue(missionId);
        runId.textContent = id ? `${id}__${YARD_ID}` : 'Waiting for the mission ID';
        paintYouTube();
    }

    // ---- Copying, on plain HTTP ------------------------------------------
    // The clipboard API only exists on a secure page, and the yard serves
    // plain HTTP on a LAN address, so on the machines this runs on it is not
    // there. Every Copy used to fall back to selecting the text and asking for
    // Ctrl-C. The older document.execCommand('copy') has no such rule, and
    // every browser still runs it from a button press, so that is the copy
    // here. The selection and the key are left for the case it is refused.
    function copyByCommand(text) {
        const area = document.createElement('textarea');
        area.value = text;
        // Read-only and off screen: no keyboard on a tablet, no jump on a page
        // that never scrolls. 16px so iOS does not zoom in to it.
        area.setAttribute('readonly', '');
        area.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;font-size:16px;';
        document.body.appendChild(area);
        area.select();
        area.setSelectionRange(0, text.length);
        let copied = false;
        try { copied = document.execCommand('copy'); } catch (e) { copied = false; }
        area.remove();
        return copied;
    }

    // Synchronous on plain HTTP: the press that asked for the copy has to be
    // the one that makes it, and an await in between can use it up.
    function copyText(text) {
        if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).then(() => true, () => copyByCommand(text));
        }
        return Promise.resolve(copyByCommand(text));
    }

    // One handler for every Copy on the page, including the YouTube pair.
    document.querySelectorAll('[data-copy]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const text = metaValue($(btn.dataset.copy));
            if (!text) return;
            const original = btn.textContent;
            if (await copyText(text)) {
                btn.textContent = 'Copied';
            } else {
                // Refused even so: leave the text selected and name the key.
                const field = $(btn.dataset.copy);
                if (field.select) { field.select(); } else {
                    const range = document.createRange();
                    range.selectNodeContents(field);
                    const sel = window.getSelection();
                    sel.removeAllRanges(); sel.addRange(range);
                }
                btn.textContent = COPY_KEY;
            }
            setTimeout(() => { btn.textContent = original; }, 1600);
        });
    });

    function paintStatus(id, ok, label, waiting) {
        const box = $(id);
        box.querySelector('.status-dot').className = `status-dot ${ok ? 'ok' : (waiting ? '' : 'bad')}`;
        box.querySelector('.status-sub').textContent = label;
        // The tile itself carries the state, not just the dot. An 8px dot is
        // not enough signal for the two things that decide whether the rest
        // of this page can do anything.
        box.dataset.state = ok ? 'ok' : (waiting ? 'wait' : 'bad');
    }

    // Send is the only filled action on the page, and it refuses rather than
    // firing into a yard that is not ready. It used to stay enabled while the
    // warning underneath said not to run, which is the console contradicting
    // itself at the one moment an operator is going fast.
    function paintGate() {
        const ready = cameraPrimed && roverOk;
        $('runBtn').disabled = !ready;
        $('runBtn').title = ready ? '' : 'Camera and rover both have to be ready first';
        $('runWarning').classList.toggle('show', !ready);
        $('runState').textContent = recordingName ? 'Recording' : (ready ? 'Ready' : 'Not ready');
    }
    // One question about the camera, answered by /api/status like everything
    // else on this page. The server holds one snapshot; this reads it.
    let cameraPrimed = false, roverOk = false;

    function paintCamera(state) {
        cameraPrimed = !!state.ready;
        const listening = !!state.listening;
        const sub = cameraPrimed ? 'Primed, frames arriving'
                  : listening    ? (state.detail || 'No frames arriving')
                                 : 'Not running';
        paintStatus('cameraReady', cameraPrimed, sub, false);
        $('camStart').hidden = cameraPrimed;
        paintGate();
    }

    $('camStart').addEventListener('click', async () => {
        const btn = $('camStart');
        btn.disabled = true;
        paintStatus('cameraReady', false, 'Starting the camera...', true);
        try {
            const resp = await fetch('/operator/api/camera/start', { method: 'POST' });
            if (!resp.ok) throw new Error(((await resp.json()) || {}).error || 'Could not start the camera');
            // The server drops its cached snapshot when the camera is started,
            // so the next poll reports what actually happened. No local timer
            // guessing when it might be up.
            setTimeout(() => YardStatus.refreshNow(), 2500);
        } catch (e) {
            paintStatus('cameraReady', false, e.message, false);
        } finally {
            btn.disabled = false;
        }
    });

    if (window.YardStatus) {
        YardStatus.subscribe((snapshot, meta) => {
            roverOk = !!(snapshot.rover && snapshot.rover.reachable && (snapshot.rover.status == null || snapshot.rover.status === 'ok'));
            paintStatus('roverReady', roverOk, roverOk ? 'Available' : 'Not reachable');
            paintCamera(snapshot.camera || {});

            // The watcher ends recordings this page started, so the page has
            // to be told. Without this it went on saying "Stop recording"
            // over a file the rover had already finished and the server had
            // already closed, and never showed the operator the video.
            //
            // Only an answer to a request sent after the recording started
            // counts. One already on its way when Send was pressed cannot
            // have the recording in it, and would announce the run finished
            // a second after the rover set off.
            const filming = (snapshot.recording && snapshot.recording.active) || [];
            const askedSinceStart = !!(meta && meta.requestedAt > recordingSince);
            if (recordingName && askedSinceStart && !filming.includes(recordingName)) {
                const file = recordingFile;
                forgetRecording();
                announceDone(file);
            }
            paintGate();
            maybeAutoRun();
        });
        YardStatus.onError(() => {
            roverOk = false;
            paintStatus('roverReady', false, 'Status unavailable');
            paintCamera({ listening: false, ready: false, detail: 'Status unavailable' });
        });
    }

    // ---- Record and run ------------------------------------------------
    function runName() {
        return (metaValue(missionId) || metaValue(missionName) || 'run');
    }

    // Off, starting (asked for, the camera not yet confirmed) or on. The
    // badge on the picture, its frame, the panel's tag and the record button
    // all read it, so they cannot disagree about whether the camera is
    // filming.
    let recClockTimer = null;
    function paintRecording(state) {
        document.querySelector('.live-panel').dataset.rec = state;
        $('recBadge').hidden = state === 'off';
        $('recLabel').textContent = state === 'starting' ? 'Starting recording' : 'REC';
        $('recDot').classList.toggle('on', state === 'on');
        $('recBtn').lastChild.textContent = state === 'on' ? ' Stop recording' : ' Start recording';
        clearInterval(recClockTimer);
        $('recClock').textContent = '';
        // A clock that moves is the proof it is still going: a badge alone
        // looks the same whether the camera is filming or stuck.
        if (state === 'on') {
            const tick = () => {
                const s = Math.max(0, Math.floor((Date.now() - recordingSince) / 1000));
                $('recClock').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
            };
            tick();
            recClockTimer = setInterval(tick, 250);
        }
    }

    function forgetRecording() {
        recordingName = null;
        recordingFile = null;
        paintRecording('off');
        paintGate();
    }

    // Recording is a thing the station does, not a button the operator has to
    // remember. Send starts it; the button in the panel head is the manual
    // override.
    async function startRecording() {
        if (recordingName) return;
        paintRecording('starting');
        let d;
        try {
            const resp = await fetch('/api/recording/start', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: runName() }),
            });
            d = await resp.json();
            if (!resp.ok) throw new Error(d.error || 'Could not start recording');
        } catch (e) {
            paintRecording('off');
            throw e;
        }
        recordingName = d.name;
        recordingFile = d.file || null;
        recordingSince = Date.now();
        // Every run gets its own file now, so the name is not predictable from
        // the mission alone and the operator is told the real one.
        if (d.file) flash($('runMsg'), 'Recording to ' + d.file, 'ok');
        paintRecording('on');
        paintGate();
    }

    async function stopRecording() {
        if (!recordingName) return;
        await fetch('/api/recording/stop', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: recordingName, keep: true }),
        });
        forgetRecording();
        loadRecordings();
    }

    $('recBtn').addEventListener('click', async () => {
        const btn = $('recBtn');
        btn.disabled = true;
        try {
            if (!recordingName) {
                await startRecording();
                flash($('runMsg'), 'Recording', 'ok');
            } else {
                await stopRecording();
                flash($('runMsg'), 'Saved. Download it from The video.', 'ok');
            }
        } catch (e) {
            flash($('runMsg'), e.message, 'bad');
        } finally {
            btn.disabled = false;
        }
    });

    // How long to let the camera settle between starting the recording and
    // moving the rover, so the first move is inside the video rather than on
    // the frame before it. The writer opens lazily on the first real frame.
    const LEAD_IN_MS = 1000;

    $('runBtn').addEventListener('click', async () => {
        const python = code.value.trim();
        if (!python) return flash($('runMsg'), 'No code to send', 'bad');

        const btn = $('runBtn');
        btn.disabled = true;
        try {
            // Record first, always. Asking an operator to remember a separate
            // button before every run meant the run that mattered was the one
            // where they forgot, and a rover run with no video cannot be
            // reviewed, handed over or uploaded - it is simply lost.
            if (!recordingName) {
                flash($('runMsg'), 'Recording...', 'ok');
                await startRecording();
                // If the recording could not start we do not send. Dispatching
                // anyway would produce exactly the unrecorded run this exists
                // to prevent, and moving the rover is not undoable.
                await new Promise((r) => setTimeout(r, LEAD_IN_MS));
            }

            // mission_id travels with the dispatch, the same way a queued
            // mission's does. The rover echoes it back on the instruction in
            // its history, which is how the watcher knows a run is over and
            // can stop the camera without anyone pressing anything. Sent only
            // when the operator has actually filled it in; the rover does not
            // care either way.
            const params = { code: python };
            const missionRef = metaValue(missionId);
            if (missionRef) params.mission_id = missionRef;
            // Travels with the dispatch for the same reason mission_id does:
            // the rover echoes params back on the instruction, and the monitor
            // renders from that.
            if (HEADER_BLOCKS.test(python)) params.blockly = true;

            const resp = await fetch('/api/queue/add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([{ cmd: 'run_python', params }]),
            });
            const d = await resp.json();
            if (!resp.ok) throw new Error(d.error || `Failed (HTTP ${resp.status})`);
            flash($('runMsg'), 'Recording, and sent to the rover', 'ok');
        } catch (e) {
            flash($('runMsg'), e.message, 'bad');
        } finally {
            btn.disabled = false;
            paintGate();
        }
    });

    // The listener must exist before a synchronous status subscriber can
    // trigger an Automatic Route handoff.
    runListenerReady = true;
    maybeAutoRun();

    function maybeAutoRun() {
        if (!runListenerReady || !automaticRunRequested || automaticRunStarted || !cameraPrimed || !roverOk) return;
        automaticRunStarted = true;
        $('runBtn').click();
    }

    $('stopBtn').addEventListener('click', async () => {
        try {
            await fetch('/api/queue/clear', { method: 'POST' });
            // Send starts the recording, so Stop ends it, keeping the file.
            // Otherwise the same operator who would have forgotten to press
            // record is left with a recording that never stops.
            if (recordingName) {
                await stopRecording();
                flash($('runMsg'), 'Rover stopped. Recording saved: download it from The video.', 'ok');
            } else {
                flash($('runMsg'), 'Rover queue cleared', 'ok');
            }
        } catch (e) {
            flash($('runMsg'), 'Could not reach the rover', 'bad');
        }
    });

    // ---- The recordings ------------------------------------------------
    function humanBytes(n) {
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
        return (n / 1024 / 1024).toFixed(1) + ' MB';
    }

    // A list of download links became a picker because the operator is not
    // browsing: they have just recorded one thing and want that one thing on
    // their device. The newest is preselected for the same reason.
    //
    // Kamo is working out a curl the operator runs from their own machine to
    // pull straight into Downloads. Until that lands this is the real path,
    // not a stand-in: /api/recordings/<name> serves the file over the LAN and
    // the browser saves it. The curl replaces the transport, not the picker.
    // Returns the list, and picks `select` in it when it is there.
    async function loadRecordings(select) {
        const pick = $('videoPick'), get = $('videoGet');
        try {
            const resp = await fetch('/api/recordings');
            const list = (await resp.json()).recordings || [];
            if (!list.length) {
                pick.innerHTML = '<option value="">Nothing recorded yet</option>';
                pick.disabled = true; get.disabled = true;
                return list;
            }
            pick.disabled = false; get.disabled = false;
            pick.innerHTML = list.map((r) => {
                const opt = document.createElement('option');
                opt.value = r.name;
                opt.textContent = `${r.name}  (${humanBytes(r.bytes)})`;
                return opt.outerHTML;
            }).join('');
            if (select && list.some((r) => r.name === select)) pick.value = select;
            return list;
        } catch (e) {
            pick.innerHTML = '<option value="">Could not read recordings</option>';
            pick.disabled = true; get.disabled = true;
            return [];
        }
    }

    function download(name) {
        // A link click rather than fetch: this hands the file to the browser's
        // own download machinery, which is what puts it in Downloads.
        const a = document.createElement('a');
        a.href = '/api/recordings/' + encodeURIComponent(name);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        flash($('videoMsg'), 'Saving ' + name, 'ok');
    }

    $('videoGet').addEventListener('click', () => {
        const name = $('videoPick').value;
        if (name) download(name);
    });

    // ---- The end of a run -----------------------------------------------
    // It was one line of small print under Send and Stop, gone in five
    // seconds, naming a card ("Save the video") that had been renamed. An
    // operator watching the yard rather than the screen missed it, and the
    // download was a 32px icon in the rail. The notice stays until it is
    // answered, and its one button downloads the file this run wrote.
    // Pressing Stop does not open it: the operator ended that run, and it
    // did not complete.
    const doneNotice = $('doneNotice');
    const pageTitle = document.title;
    let doneFile = null;

    // ---- And whose move it is -----------------------------------------
    // Its one button was Download whether or not the satellite was about to
    // upload the video by itself, so the operator could not tell whether the
    // next step was theirs. Now it says. When the video uploads by itself
    // there is nothing to do and the button is OK; when automatic upload is
    // off, or this video could not go, it is Download and YouTube Studio, as
    // it always was. It follows the upload while it is open, because a video
    // that is waiting can still end up needing a hand.
    //
    // The watcher stops the recording first and leaves the video's upload
    // note after, so the first look can come before the note exists. A
    // satellite that uploads gets NOTE_GRACE_MS to write one; a video with no
    // note by then is not going by itself.
    const NOTE_GRACE_MS = 20000;
    const FOLLOW_MS = 2000;
    // The pills are Settings' words for the same states.
    const DONE_SAYS = {
        none: { what: 'has finished. No video of it was found on this satellite.' },
        off: { yours: true, what: 'has finished. Automatic upload is off, so download the video and upload it in YouTube Studio.' },
        manual: { yours: true, pill: ['warn', 'Upload by hand'],
                  what: 'has finished, but its video could not upload by itself. Download it and upload it in YouTube Studio.' },
        waiting: { pill: ['info', 'Waiting to upload'],
                   what: 'has finished. Its video uploads to YouTube by itself, so there is nothing for you to do.' },
        sending: { pill: ['info', 'Uploading'],
                   what: 'has finished. Its video uploads to YouTube by itself, so there is nothing for you to do.' },
        offline: { pill: ['warn', 'Waiting for internet'],
                   what: 'has finished. Its video uploads to YouTube by itself once this satellite has internet, so there is nothing for you to do.' },
        uploaded: { pill: ['ok', 'On YouTube'],
                    what: 'has finished, and its video is on YouTube and on the mission. Nothing for you to do.' },
        // Mission Control uploads it but leaves it off the run: attaching
        // would close the run and tell the learner it is complete.
        unlinked: { pill: ['warn', 'On YouTube'],
                    what: 'stopped with an error. Its video is on YouTube but not on the mission: decide on Mission Control whether the run counts.' },
    };
    const SETTLED = ['none', 'off', 'manual', 'uploaded', 'unlinked'];
    let doneEntry = null, doneSince = 0, doneFollow = null;

    function uploadPlan(entry, uploads, waited) {
        if (!entry) return { kind: 'none' };
        const u = entry.upload;
        if (u && u.state === 'uploaded') return { kind: u.outcome === 'error' ? 'unlinked' : 'uploaded', url: u.url };
        if (u && u.state === 'manual') return { kind: 'manual' };
        // Waiting, or not noted yet: whether it goes by itself is the satellite's to say.
        if (!uploads || !uploads.configured) return { kind: 'off' };
        if (u && u.state === 'sending') return { kind: 'sending', percent: u.percent };
        if (!u && waited >= NOTE_GRACE_MS) return { kind: 'manual' };
        return { kind: uploads.online === false ? 'offline' : 'waiting' };
    }

    function paintDone() {
        const snapshot = window.YardStatus ? YardStatus.latest() : null;
        const plan = uploadPlan(doneEntry, snapshot && snapshot.uploads, Date.now() - doneSince);
        const says = DONE_SAYS[plan.kind];
        doneNotice.dataset.upload = plan.kind;
        $('doneWhat').textContent = says.what;
        const pill = $('doneUpload');
        pill.hidden = !says.pill;
        if (says.pill) {
            pill.dataset.tone = says.pill[0];
            pill.textContent = plan.kind === 'sending' && plan.percent != null
                ? `Uploading ${Number(plan.percent)}%`
                : says.pill[1] + (plan.url ? ' \u2197' : '');
            if (plan.url) {
                pill.href = plan.url; pill.target = '_blank'; pill.rel = 'noopener noreferrer';
            } else {
                pill.removeAttribute('href');
            }
        }
        // A button that goes while it has the focus would take it away from
        // the dialog, so the focus moves to the one that replaces it.
        const focused = document.activeElement;
        $('doneDownload').hidden = !says.yours;
        $('doneClose').hidden = !says.yours;
        $('doneOk').hidden = !!says.yours;
        const primary = says.yours ? $('doneDownload') : $('doneOk');
        if (focused && focused.hidden && doneNotice.open) primary.focus();
        return { plan, primary };
    }

    async function followUpload() {
        doneFollow = null;
        if (!doneNotice.open || !doneFile) return;
        try {
            const list = (await (await fetch('/api/recordings')).json()).recordings || [];
            doneEntry = list.find((r) => r.name === doneFile) || doneEntry;
        } catch (e) { /* the next look may do better */ }
        if (!doneNotice.open) return;
        const { plan } = paintDone();
        if (!SETTLED.includes(plan.kind)) doneFollow = setTimeout(followUpload, FOLLOW_MS);
    }

    async function announceDone(file) {
        const list = await loadRecordings(file);
        // The satellite names the file when the recording starts. If it did
        // not, the newest is this run's: it is the last thing written.
        const entry = list.find((r) => r.name === file) || (file ? null : list[0]) || null;
        doneFile = entry ? entry.name : file;
        doneEntry = entry;
        doneSince = Date.now();
        $('doneName').textContent = metaValue(missionName) || 'The rover';
        $('doneFile').textContent = entry ? `${entry.name} · ${humanBytes(entry.bytes)}` : (doneFile || '');
        $('doneFile').hidden = !doneFile;
        $('doneDownload').disabled = !doneFile;
        const { plan, primary } = paintDone();
        // For a station left in a background tab: the tab says so too.
        document.title = 'Mission complete · ' + pageTitle;
        if (!doneNotice.open) doneNotice.showModal();
        primary.focus();
        clearTimeout(doneFollow);
        if (!SETTLED.includes(plan.kind)) doneFollow = setTimeout(followUpload, FOLLOW_MS);
    }

    function closeDone() { if (doneNotice.open) doneNotice.close(); }
    // Escape closes a dialog by itself; this is the one place either way ends.
    doneNotice.addEventListener('close', () => {
        document.title = pageTitle;
        clearTimeout(doneFollow);
        doneFollow = null;
    });
    $('doneClose').addEventListener('click', closeDone);
    $('doneOk').addEventListener('click', closeDone);
    // The dialog has no padding of its own, so a click on it is a click on
    // the backdrop.
    doneNotice.addEventListener('click', (e) => { if (e.target === doneNotice) closeDone(); });
    // Downloading is what the notice was for, so it goes once that is done;
    // the rail has the title and description the upload needs next.
    $('doneDownload').addEventListener('click', () => {
        if (!doneFile) return;
        download(doneFile);
        closeDone();
    });

    // ---- The live view --------------------------------------------------
    // Same stream and same shared client as the monitor. The camera runs on
    // the same machine as this web server, so the host comes from wherever
    // this page was served; the port is server config.
    const liveMsg = $('liveMsg');
    const feed = new CameraClient($('cameraCanvas'), {
        onStatus: (state, text) => {
            liveMsg.hidden = (state === 'connected' || state === 'disabled');
            if (state !== 'disabled') liveMsg.textContent = 'Camera: ' + text.toLowerCase();
        },
    });
    feed.connect(`ws://${window.location.hostname}:${PAGE.cameraPort}`);

    // ---- The live column is as wide as its picture ------------------------
    // The picture is 4:3 and as tall as the row less the panel's header and
    // its controls. Those two are as tall as their words make them, which
    // changes with the column's width and with whether a warning is showing,
    // so the width is measured here and handed to the stylesheet as --live-w
    // (.desk-grid has the limits, and what this replaced).
    //
    // Watching the header and the controls as well as the row: a warning
    // appearing takes 40px from the picture, and the column narrows to match
    // rather than leaving the picture short of its box.
    (function fitLiveColumn() {
        const grid = document.querySelector('.desk-grid');
        const panel = grid && grid.querySelector('.live-panel');
        if (!panel || typeof ResizeObserver === 'undefined') return;
        const head = panel.querySelector('.panel-head');
        const foot = panel.querySelector('.live-foot');

        let queued = false;
        function fit() {
            queued = false;
            const edgesTall = panel.offsetHeight - panel.clientHeight;
            const edgesWide = panel.offsetWidth - panel.clientWidth;
            const tall = grid.clientHeight - head.offsetHeight - foot.offsetHeight - edgesTall;
            const wide = Math.max(0, Math.floor(tall * 4 / 3)) + edgesWide;
            grid.style.setProperty('--live-w', wide + 'px');
        }
        // One fit a frame however many of the three changed in it, and never
        // from inside the observer's own callback, which is how a layout
        // that answers a resize with a resize ends up in a loop.
        function later() {
            if (queued) return;
            queued = true;
            requestAnimationFrame(fit);
        }
        const observer = new ResizeObserver(later);
        [grid, head, foot].forEach((el) => observer.observe(el));
        // Now, and not a frame from now. The observer would get to it, but
        // the page would paint once with the column at its old share first.
        fit();
    })();

    // What the rover is doing right now, from the same queue stream the
    // monitor watches. This is the "monitoring" half of the page: the SSE
    // carries changes, the one fetch carries whatever happened before the
    // page opened, and both land in the same dispatcher - which is also what
    // the simulated view subscribes to on a fake-rover yard.
    const queueSubscribers = [];
    let lastQueueStatus = null;
    function dispatchQueue(status) {
        lastQueueStatus = status;
        for (const fn of queueSubscribers) {
            try { fn(status); } catch (e) { console.error('[run] queue subscriber failed:', e); }
        }
    }
    // Late subscribers replay the last snapshot, for the same reason the
    // monitor's hook does: the sim module registers after an await, by which
    // time the backlog fetch has usually already landed.
    function onQueueEvent(fn) {
        queueSubscribers.push(fn);
        if (lastQueueStatus) {
            try { fn(lastQueueStatus); } catch (e) { console.error('[run] queue subscriber failed:', e); }
        }
    }

    onQueueEvent((status) => {
        const cur = status && status.current;
        const pending = (status && status.pending_count) || 0;
        const queued = pending ? ` · ${pending} queued` : '';
        $('liveNow').textContent = cur
            ? `Rover: ${(cur.cmd || '').replace(/_/g, ' ')}${queued}`
            : `Rover idle${queued}`;
    });

    // Retried because one attempt was too few on the monitor: a rover blip on
    // load looked exactly like "the mission I just sent is missing".
    (function loadQueueBacklog(attempt) {
        fetch('/api/queue/status')
            .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(dispatchQueue)
            .catch(() => { if (attempt < 5) setTimeout(() => loadQueueBacklog(attempt + 1), 1000 * attempt); });
    })(1);
    new EventSource('/api/queue/events').onmessage = (event) => {
        try { dispatchQueue(JSON.parse(event.data)); } catch (e) { /* partial frame */ }
    };

    // Handed to the simulator module below. The same narrow surface the
    // monitor exposes, so initSimIfFakeRover works against either page.
    window.__yardRunHooks = {
        camera: feed,
        onQueueEvent,
        setLabel: (text) => {
            const mode = $('liveMode');
            mode.textContent = text;
            mode.hidden = false;
        },
    };

    paintYouTube();
    loadRecordings();
})();
