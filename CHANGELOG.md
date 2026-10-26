# Changelog

What has actually happened to this project, in order. Written for someone
picking it up later: the entries say why a thing changed, not only that it
did, because the why is the part git does not preserve on its own (AB#358).

Dates are when the work merged to `main`. PR numbers link to the discussion,
which is often longer than the diff.

---

## Unreleased

- **Chrome on a phone can be asked for local network access.** A mission
  opened on an https page checks, before anything is pressed, whether the
  browser can reach the http satellite at all, and a browser that could not
  name the local network permission was told "This browser cannot reach the
  yard", with Check yard and Send to Rover taken away. Chrome on Android
  answers that way but still asks when a request is made, so the phone was
  told to open Chrome, in Chrome, and never got the request that would have
  asked. Chromium browsers now keep Check yard; pressing it is what lets
  Chrome ask, and a request that still fails says the yard is offline with
  Try again. Safari and Firefox are unchanged.

- **How long a video keeps filming after its run is a slider on Settings.**
  The tail was a fixed three seconds in `mission_watcher.py`, chosen by
  watching the real rover come to rest. A yard whose camera sees the rover
  stop sooner or later had no way to change it without a code change. It is
  now the `recordingTail` setting, 0 to 10 seconds in half seconds, on the
  Camera card under "Keep filming after a run for", and the watcher reads it
  on every pass, so a change applies from the next run. Three seconds stays
  the default.

- **The satellite's pages keep their scripts in files of their own.** The
  run station, Settings, the monitor, the code tablet and the shared nav bar
  each carried their JavaScript inline, 3,450 lines between them (Settings
  alone was 1,991 lines, 1,244 of them script). Each is now
  `yard/satellite/static/pages/<page>.js`, loaded from the spot the inline
  block stood in, so it runs at the same moment as before. The three values
  the server rendered into those scripts (the yard id and the camera port)
  travel as `data-` attributes on the script tag. The code tablet's offline
  cache lists its new file. Behaviour is unchanged; tests that read a page's
  text read its script file with it (`tests/page_source.py`).

- **Only a mission Mission Control signed starts a rover run by itself.**
  Send to Rover opens the satellite's run station with the mission in the
  address, and the run station pressed its own Send as soon as the camera and
  rover were ready. Anything can open a link, so any page a yard browser
  visited could have started filming and moved the rover with code of its
  choosing; the same-origin check on the satellite's POSTs did not cover it,
  because the POST came from the run station itself. Mission Control's server
  now signs the handoff for the operator's yard (the stored code, never the
  request's, for five minutes) with the upload secret the satellite already
  holds, and the satellite checks the signature once. A verified handoff
  still needs only the one press in Mission Control. Anything else, a link
  from elsewhere or a satellite with no secret set, fills the run station and
  waits for Send. A shared test vector keeps the two languages' formats in
  step.
- **A mission is an entity with its own lifecycle, not a record that any
  layer may change.** `Mission` was an interface of about 25 public fields,
  and the rules for changing it lived in loose functions beside it
  (`missionBookkeeping.ts`), fed a hand-built snapshot by whoever called them.
  It is now a class that holds a mission's record and runs privately and
  answers every operator action itself: complete, cancel, log another run,
  attach or remove a video, leave feedback, resolve a review. `Mission.submit`
  is the one place a new mission is given its first status. The stored shape
  keeps its plain form as `MissionRecord`, because it crosses Firestore and
  the server-to-browser boundary and neither carries a class; the feed and
  the cards read that. A new rule in `architecture.test.ts` fails on a
  mission status written anywhere else in core or persistence. Behaviour is
  unchanged: the bookkeeping tests moved onto the entity with the same
  expectations, and gained cases for which run is acted on and for the
  record not being changeable from outside.

- **When one admin grants a request for access, the others hear about it in
  the same email thread.** Someone who asks for operator access emails every
  admin, and nothing told the rest once one of them had let the person in, so
  each was left to check Manage access or to do it again. David suggested a
  reply in the thread. Granting the access now sends one to every admin who
  got the request, except the one who granted it: "Re:" under the request's
  subject, saying who gave which access and that there is nothing to do. It
  lands in the thread because it names the request's Message-ID, which Resend
  is asked for at the time, since its send response gives only its own id. So
  the request now records which email went to which admin, and keeps an
  earlier ask's emails when the person asks again after the hour, so the one
  reply answers both. Requests made before this change have no such record and
  get no reply. A reply that fails never fails the grant.

- **The camera stream only plays on the satellite's own pages.** The camera
  server streams the Pi camera over a WebSocket (port 8890) and checked no
  Origin. Browsers allow cross-origin WebSocket connections, so any website a
  browser on the yard's wifi had open could open a live view of the yard, which
  films children. The handshake now checks its Origin: it is served only to the
  satellite's own pages (its host on the web port, so it works by name or by
  IP), refused with a 403 otherwise. A handshake with no Origin is a non-browser
  client, the satellite's own recording consumer or a readiness probe, and is
  still allowed, so nothing on the box breaks.

- **Mission Control's public routes cannot be used to spam.** Learners are
  anonymous by design, so a handful of routes stay open, but nothing limited
  them. `/api/missions/[id]/notify` accepted any status for any mission id, and
  mission ids are public on the feed, so it was a lever for mailing a learner.
  It is now narrowed to the one thing its caller needs: the first queued email,
  sent only while the mission is still queued and only once (recorded in a
  transaction so two calls cannot both send). Mission submission, saving a
  learner's email, and asking an admin for access now carry rate limits, keyed
  by the caller's real client IP (read from Cloudflare's header, then the
  forwarded chain). The numbers are set so a class of children behind one
  school IP is never blocked, and the limiter fails open: if its Firestore
  store is unreachable, the request is allowed rather than a child being
  stopped from submitting. The counter lives in a server-only collection the
  rules deny to browsers outright.

- **The satellite and the rover only take a state change from the yard's own
  pages.** Neither has a sign-in, on purpose: the yard has to work with no
  internet. But that left every state-changing endpoint open to any website a
  browser on the yard's wifi had open in another tab, which could POST to it
  with no preflight. The worst took no body at all: a cross-site page could
  power the satellite off (`/operator/api/satellite/shutdown`) or stop the
  rover mid-run (`/api/queue/clear`). A single gate now sits in front of every
  route on each server and refuses a POST, PUT, PATCH or DELETE that did not
  come from the server's own origin, read from the browser's Sec-Fetch-Site
  and Origin headers. A request with neither header is a non-browser caller
  (the satellite's own proxy, the tests) and passes, so nothing on the LAN
  breaks. This is not a sign-in and adds no gate an operator can hit when the
  wifi is down. A test walks every route so a new endpoint cannot skip the
  rule.

- **A re-run's video gets a run of its own.** Running Quiet Storm Finder
  again on 25 October uploaded its video to YouTube, and Mission Control still
  showed one run with the first video. The linker looks for a run without a
  video, and a mission run before has none left, so the new video was
  dropped. An automatic upload knows the run it filmed, the dispatch the
  satellite sent, so it now goes to that run, created when it is not there
  yet and named for the dispatch so a second delivery lands on the same run.
  Like an operator's Log another run, the new run is completed and the
  learner is emailed. Videos found by the scheduled poll, which cannot know
  their run, are unchanged.

- **A run's video ends three seconds after the run.** The watcher asked the
  rover whether a run was over every ten seconds, so every recording ran on
  for up to ten seconds of a rover sitting still. Stopping the moment the
  rover reported the run over was tried on the real rover and cut the end
  off, because the camera's picture lags the report. It now asks every half
  second, only while a recording is open, and films three more seconds once
  the run is over; uploads, the overdue cap and cleanup keep their own slower
  timers. Seen on the first real-rover runs after the driver change on 25
  October.

- **Re-running a mission no longer ends its recording early, or claims a run
  that never happened.** A recording with no dispatch yet fell back to any
  completed run of its mission in the rover's history, including the
  previous one. Re-running from the run station stopped the new recording in
  the lead-in second before the rover was sent anything, and when the send
  failed the page said Mission complete for a rover that had not moved. Only
  a run that finishes after the recording started can end it now. The faster
  polling made this common; at ten seconds it hit about one re-run in ten.

- **No route calls the Admin SDK itself.** After the team route, three more
  held their work inline: sign-in verified tokens, minted cookies and applied
  invites; "Ask an admin" kept its own hourly ledger and emailed the admins;
  the learner email route walked the private contact path by hand. Each is a
  controller over a use case or repository now (`OperatorSessionService`,
  `OperatorAccessRequests`, `ILearnerContactWriter`), with Firebase-free tests,
  and architecture.test.ts fails if a route imports the Admin SDK again.

- **The satellite is an app factory.** `web_server.py` was the app, its config,
  its state and every page and API in 723 lines, built on import, with the
  rover's address in a `global`. It is `create_app()` now (91 lines); the routes
  are blueprints in `yard/satellite/routes/`, and the address is app config. The
  Pi needs a pull and a restart of `satellite-web` to pick this up.

- **No `any` in production code, and comments without ticket numbers.** The 29
  were all Blockly; the generator takes narrow `RoverWorkspace` and `RoverBlock`
  interfaces and the editors use Blockly's own types. 148 board references in
  comments became the reason they stood for. Three tests that checked behaviour
  by reading source text now check the behaviour.

- **The simulator runs a learner's program on the fake rover.** Learner
  Python was given whichever `rover` library would import, so on the
  satellite's simulator, a Pi where the hardware library imports, programs
  went to the real library and the fake driver never saw them: "the same
  server with one object swapped" was not true for the one thing learners
  send. Each driver now hands out the learner's `rover` (`learner_rover()`):
  the real one gives the same hardware library as before, the fake one keeps
  the calls as its own state. Both hold motion speeds to 0-100, so a speed in
  a variable, which no validator can read, is refused before a motor sees it.
  The old import fallback to `legacy/simulator/roversimulator.py`, which
  needed a web simulator nobody runs, is gone. Needs one run on the real rover
  to confirm, though in-range calls reach the library unchanged.

- **What a status means is decided once.** The operator card treated only
  completed and cancelled as settled, while the server treated failed and
  not_completed as settled too, so a run that did not finish offered Mark
  complete and Cancel, which the server always refused, and hid the note box
  on the run whose learner most needs a note. `MissionState` now answers it
  for both, and architecture.test.ts fails if a status rule is written out at
  a call site again. `YouTubeVideoId` does the same for video links: the card
  had its own parser that disagreed with the operator's, and drew broken
  thumbnails for links that could never be attached.

- **The View no longer talks to Firestore.** Ten components and hooks
  imported Firestore modules directly, and the learner context read and wrote
  its record itself. They go through `container.browser.ts` now, behind ports
  in core (`ILearnerRepository`, the live feeds in `IMissionFeeds`), with a
  rule in architecture.test.ts. The mission repository is split by SDK: one
  reader base class, an Admin subclass for the server and a browser subclass,
  where it used to ask which SDK it held in every method. A contract test runs
  both against one dataset, so the browser's reads have a test for the first
  time. The operator team route is a controller over `OperatorTeamService`
  instead of 250 lines of Firebase calls.

- **Dead code removed.** The idempotency feature that
  `IMPLEMENTATION_SUMMARY.md` advertised had no production caller, nor did
  `upsertRun`, the free-form `MissionService.updateMission`, the update
  schema, the mission lock fields, the learner counters and device list
  (never written after creation), or the satellite's `satellite_id()`. The
  seven `it.todo` stubs, both implementation summaries and the five stale
  plans in `docs/plans/` went with them. Collection names live in one module,
  and the badge colours moved out of `core/domain`.

- **A satellite that uploads keeps a clean `git status`.** Each video's
  upload note (`<name>.mp4.upload.json`) was not ignored, so after its first
  automatic upload on 24 October the Pi showed untracked files, and an empty
  `git status` is how the runbook tells a Pi serving stale code from one that
  is not. The whole `yard/satellite/recordings/` folder is ignored now, so the
  next kind of file written there cannot do it again.

- **The satellite's upload secret is set on its Settings page.** It was a line
  in a `.env` on the Pi, the last setting that still needed one. It sits in the
  Mission Control dialog now, with the address, and the page never shows it
  back: only whether one is set, and for which address. The console has no
  sign-in, so anyone on the yard's wifi could change the address, and a secret
  that followed it would arrive at their server in the next upload's headers,
  enough to post videos to the channel as this yard. So it is only ever sent to
  the Mission Control it was entered for, and a new address asks for it again.
  The runbook has how the team sets a value without being able to read
  Terraform's.

- **An automatic upload is titled after its mission, and Mission complete
  says whose move it is.** The first automatic upload, on 24 October, worked
  end to end and was called `zAHtPQvGW-_upbuw9NAeh__curiosity__20261024T141312Z`,
  its recording's file name. It is now `Cheerful Pebble Ranger · Mars Yard
  rover run`, the title the run station already suggests for a manual
  upload, read by Mission Control from the mission; a test holds the two
  wordings together. A name a child typed stays off YouTube, as it stays out
  of links. Nothing finds a video by its title, so linking is unchanged.

  The run station's Mission complete notice had one button, Download,
  whether or not the satellite was about to upload the video by itself, so
  an operator could not tell whether to step in. Now, with the video
  uploading by itself, it says there is nothing to do, its button is OK, and
  it follows the upload to the YouTube link. With automatic upload off, or
  an upload that could not happen, it says so and its button downloads the
  video for YouTube Studio, as before. A run the rover reported as an error
  is uploaded but left off the mission, and the notice sends the operator to
  Mission Control to decide whether it counts.

- **Prod goes live on a database of its own.** The live site moves from
  `marsyard.labs.ws`, the service called staging, to `marsyard.sapient.rocks`,
  which served Google's placeholder page since August. Prod starts clean on a
  new Firestore database, `prod`, in the same project; staging keeps
  `(default)` with every mission since the pilot, and David's handpicked
  missions are copied across (`scripts/copy-to-database.mjs`, no learner
  records or email addresses). A database rather than a project, because a
  project needs billing, a load balancer, a certificate, a DNS move and every
  operator account made again. Operator roles live on Firebase Auth, which the
  project shares, so operators carry over. Werner reviews and applies it in
  one sitting: [docs/go-live.md](docs/go-live.md).

  The database is read at runtime, by the server from `FIREBASE_DATABASE_ID`
  and by the browser from a tag the server puts in every page, because prod
  runs the image built for staging and a build-time value would be staging's.
  Prod refuses to run without one rather than open staging's. Its service
  account may reach only `prod`, an IAM condition, so the two are separate in
  fact and not only by convention.

  Found on the way, and fixed with it: both services billed CPU around the
  clock, because setting memory limits silently flipped a provider default
  (#240, about $63 of $87 a month); port 80 served the whole app over plain
  HTTP, email addresses included, and now redirects; staging would have stayed
  in search results next to prod; three hand-made YouTube secrets would have
  failed the next apply; and `firebase deploy`, even with `--dry-run`, creates
  a missing database by itself without Terraform's settings, so the rules
  script refuses until Terraform has made it. The Firestore emulator cannot
  load rules from a list of databases (it allows everything instead), so
  prod's rules deploy from their own `firebase.prod.json`.

  The yard's Mission Control address is a setting on the satellite's Settings
  page now, not a line in a file, and the uploader reads the same one as the
  console link. It defaults to prod.

  The apply also creates the privacy contact setting's secret for `/privacy`
  (#327), and a test now checks every admin setting has a secret Terraform
  creates and lets the app use: the YouTube upload settings had sat on the
  Settings page with nowhere to be saved.

- **A privacy and terms page, linked from Help and from the email prompt.**
  Mission Control collects learners' email addresses, and many learners are
  children, and there was no page saying what happens to them, or what anyone
  agrees to by sending a mission. `/privacy` has both. The privacy half says what is
  kept and why (missions are public; the email is optional, kept where no web
  page can read it, and only a scrambled form is on missions), who else
  handles it (Google Cloud, Firebase, Resend, YouTube, and PostHog, mentioned
  only when PostHog is actually running), how long, and how to see or delete
  it. The terms half is short enough for a child to read: missions are
  public, be kind, a real rover does not always match the simulator, your code
  is yours but SAPIENT may show it, no promises, South African law. `/terms`
  lands on that half. Written from the code, for children and their parents.
  Google also requires both links before the YouTube sign-in can leave
  testing. The contact is an
  admin setting on the Settings page, for David to set; until then the page
  says to ask an operator at the yard. The email prompt adds "Under 18? Ask a
  parent or teacher first." and a link to the page in a new tab.

- **A recording keeps every character of its mission's id.** Mission ids can
  start or end with a dash, about 3 in 100 of them, and the satellite dropped
  it when it named the recording: `-BQwFDUWvyhpbQ4ZI8het` was filed as
  `BQwFDUWvyhpbQ4ZI8het`. An operator uploads that file to YouTube Studio, the
  file name becomes the video's title, and Mission Control reads the mission id
  back out of the title. One character short, it named no mission, and the
  video never linked. A name that needs nothing replaced is now filed whole;
  a name somebody typed, like "Thabo's square!", is still tidied to
  `Thabo-s-square`. A 60-character name could also be shortened a second time
  when Stop handed it back, so Stop looked for a recording nobody had started;
  naming it twice is now the same as naming it once. Automatic upload was
  never affected: it sends the mission id itself, not the file name.

- **The run station says when it is recording, and says when the run is
  done.** Both were small and grey. A recording was a 9px dot inside a grey
  button and a grey tag, so a run being filmed looked like one that was not,
  until the video turned up afterwards. The end of a run was a line of small
  print under Send and Stop, gone in five seconds, pointing at a card called
  "Save the video" that had since been renamed; the download itself was a
  32px icon in the rail.

  While the camera records, the picture carries a red REC badge with a clock
  that runs, the way a camera says it, and a red edge. Until the satellite
  has said yes it reads "Starting recording" on dark glass instead, so it
  never claims a recording that has not begun. When the rover finishes, a
  large "Mission complete" notice opens over the page with the mission's
  name, the file and its size, and one button that downloads that run's
  video, not whichever is newest on the card. It stays until it is answered,
  and the tab's title says it too. Pressing Stop does not open it: that run
  did not complete.

  Making the notice that loud brought out a race that a line of small print
  had hidden. `/api/status` read the list of recordings from the camera's
  snapshot, which is kept for four seconds, so a status asked for just
  before Send could come back without the new recording, and the station
  took that as the run having finished. The list is now read live, and the
  station only believes a status it asked for after the recording started.

- **About is under Help.** It was a loose link beside the laptop's Home and
  My History pill, and on a phone it shared the top bar with the logo. The
  Help button, which only restarted the walkthrough, now opens a small menu
  over the page with "Take the tour" and "About Sapient.rocks". About was not
  made a tab or put in the pill: both bars are for places in Mission Control,
  and About opens another website, so a tab there takes a learner out of the
  app. The phone's bar keeps its three slots, and the fourth Challenges needs
  when it comes back. The walkthrough's welcome shows the rover instead of a
  rocket icon, and its text no longer uses dashes.

- **Copy on the run station copies.** Every Copy button selected its text and
  said "Ctrl-C", because the clipboard API it used only exists on HTTPS or
  localhost, and the yard serves plain HTTP on a LAN address. The older
  `document.execCommand('copy')` has no such rule and still works from a
  button press in every browser, so that is the copy now. The selection and
  the key are only left for a browser that refuses even that.

  Paste cannot work the same way. No browser lets a plain HTTP page read the
  clipboard, by any route, so the paste button still opens a box to paste
  into. It now says the one gesture the device in hand has: "Press ⌘V" (or
  Ctrl-V) on a laptop, "Press and hold here, then tap Paste" on a tablet.
  Making paste one press would mean serving the satellite over HTTPS. Sending
  the mission from Mission Control in Chrome needs no paste at all.
- **The yard's network is a router that reaches the internet, and the docs
  say so.** The satellite served `marsyard`, and one radio cannot be an access
  point and a client, so the yard had no internet: no clock for the satellite,
  no `git pull` in the room, no upload from where a video was made. A Cudy
  LT300 now serves `mars-relay-network` and joins whatever wifi is there for
  the internet: WISP on, at `http://cudy.net`. Set up and working at home on
  21 October 2026, with the satellite moved onto it;
  `setup-scripts/satellite-join-relay.sh` does that move for a fresh satellite.

  `marsyard` is retired, for predictability: one name everywhere. A Pi that
  joins a network stays on it, so with both saved, the satellite fell onto a
  `marsyard` hotspot when the relay blipped and stayed there after it came
  back. It is deleted from the satellite and from the rover. If the
  router is missing, a phone hotspot called `mars-relay-network` with its
  password stands in for everything.

  The docs had gone on describing the yard as it was. `yard-network.md`, the
  manual, `bring-up.md` and the rover's handover note describe the router;
  the network diagram's writeup describes the yard without the Firestore
  mirror and the signed-in console it still showed; `docs/repo-handoff.md`
  lists the yard's hardware and its passwords and keys, which no merge moves;
  the RUNBOOK covers a console that will not come up, restarting the
  satellite's services and a yard with no internet; and `infra/README.md`
  gives the three `terraform import`s the next apply needs first.
- **Automatic uploads reach the run, and wait for a connection.** Two gaps
  in the automatic YouTube upload (#304), found reviewing it on 20 October.
  Kept on a branch, not merged: David has lowered auto-upload in priority.

  The uploaded video never reached the learner's page. Its id went into a
  ledger only operators read, and attaching it was left to the scheduled
  linker, which reads the channel with an API key and cannot see a private
  video; uploads are private by default. Now the upload attaches it through
  the same linker, moved out of the cron route into one application service
  both call, so it closes an open run and emails the learner exactly as a
  found video does. Not for a run the rover reported as an error: whether that
  counts is the operator's call.

  And the satellite gave up after three tries in a few seconds. Serving the
  yard's wifi, it has no internet, so in the yard as it is normally set up
  every try failed and none came later. A note beside each recording now waits
  until Mission Control has the video or has refused it for good, retried
  every watcher pass when due, and written so that a power cut cannot leave it
  half written. When the connection comes back, everything waiting goes within
  a minute, rather than at the end of a half-hour back-off.

  And the operator can see it. A chip in the top bar of every console page
  says how many videos are waiting, the one going out and how far it has got,
  or that all of them are on YouTube; below a laptop's width it comes down to
  its icon and a number, and on an upright tablet the brand's name gives way
  while it is up. The Recordings card on Settings gives each video its state
  (uploading and its percentage, waiting, on YouTube with the link, or to
  upload by hand and why) and the day's tally. It counts down to closing, a
  setting that defaults to the science centre's 16:30, and from half an hour
  before it says whether switching off loses anything: videos still waiting
  go up by themselves next time the satellite is online. The video is now
  sent as it is read off the card, so the percentage is real and a 30 MB file
  is never held whole in the Pi's memory.
- **The satellite shuts down from its Settings page, and restarts without a
  password.** It was switched off at the plug. On 17 October that emptied
  every file a `git pull` had written a few minutes before, 87 of them,
  because the card had not been given their data yet, and the console never
  came back up. A recording still open when the power goes does not play
  either. The power button beside the Satellite chip now closes and keeps any
  recording still running, then powers off cleanly, and says when it is safe
  to unplug.

  Shutting down needs root, and so did restarting the satellite's services
  after a pull, which meant the `mars` password every time and no restart an
  agent could do. `yard/deploy/satellite.sudoers` allows exactly those
  commands with no password: restart `satellite-web` and `satellite-camera`,
  stop the camera, and power off. Nothing broader, because the console has no
  sign-in and anyone on the yard's wifi can press its buttons. A test fails if
  the code asks sudo for a command the rule does not list, or the rule allows
  one the code does not use. It is installed once on the Pi with
  `sudo bash yard/docs/setup-scripts/satellite-sudoers.sh`; until then the
  button says what setting it up takes.

- **The run station works on a phone.** Stacked, the rail took all the height
  its cards wanted before the live panel got any: 365px of an iPhone's 598.
  The panel was left its 220px floor, and its header and controls alone are
  257. So a phone showed no camera picture at all, and the foot of the panel
  was cut off through the middle of Send and Stop. The panel now comes first:
  it is as tall as a picture the width of the phone and the controls under
  it, and the rail has the rest, never under 7rem, and scrolls inside itself.
  To find the height, the sentence under the page's title is not shown on a
  phone and the camera and rover checks sit side by side. On a short phone
  (667 tall and under) the picture is fitted in what is left, about 150px,
  with the start-mark reminder on one line and the two buttons at 48px. The
  panel's bar no longer runs past its edge; "Start recording" was cut through
  its last letter.

- **The satellite can turn its camera's picture round.** The Cape Town camera
  films the yard half a turn round from the simulator's map: the start spot is
  on the right of the video and on the left of the simulation, and north is at
  the bottom. Nobody noticed until a mission's page showed the two at the same
  size, one above the other (13 October). Settings has a "Which way up" choice
  now, "As mounted" or "Turned round". It saves on the click and the picture
  turns within a second, with no camera restart. The turn is made where a
  frame is made, so the monitor, the run station and the recording all follow,
  and detection boxes are moved with the picture and drawn after it so their
  labels stay the right way up. A yard that sets nothing is left as it was.
  Recordings already made, and the videos already on YouTube, do not change.

- **The TV monitor shows the whole of the camera's picture.** The camera is
  4:3 and a television is 16:9. The monitor gave the camera two thirds of the
  screen whatever its shape and drew the picture to that width, so on a 1080p
  television the picture was taller than the screen and the bottom 130px of
  the yard, its near wall, was off the foot of it. The camera's panel is now
  as wide as a 4:3 picture is at the screen's full height, and the queue has
  the width that leaves: the picture fills its panel, nothing is cut off and
  nothing stands beside it. The two bars along the top were 71px and 49px tall
  and are one height. The canvas also takes each frame's own size now. It was
  a fixed 640 x 480 that every frame was drawn down to, so the two sharper
  picture qualities on Settings changed nothing on the one screen they are
  for; the run station's live view shares the fix.

- **The run station's live view is the camera's picture, with no bars beside
  it.** Its column was a fixed share of the window, wider at every laptop size
  than a 4:3 picture as tall as the column left room for, so the picture sat
  in the middle of its panel with a dark bar down each side: 118px of bar at
  1366 x 768, while the rail beside it scrolled for want of width. The column
  is now as wide as the picture. Its height is what the panel's header and
  controls leave, which changes with a warning showing and with how the words
  wrap, so the page measures it and refits when either changes. The rail has
  the width the picture gave up (792px instead of 557 at that size). On an
  upright tablet, where the width is the limit, the panel ends under its
  buttons instead of stretching the view to the foot of the screen. Stacked
  on a phone it is unchanged.
- **The yard console's top bar fits a tablet and a phone.** Laid out in full the bar is
  about 950px wide once the rover is online with a queue, and the only width
  it changed at was the phone's, 760px. Everything between pushed the rover
  chip past the right edge. On a tablet held upright, 768 wide, the chip was
  wholly off screen on the hub, the run station and Settings, and each of
  them scrolled sideways, which a console page is never to do. The breakpoint
  is older than the way back to Mission Control at the front of the bar
  (#216), and no test had measured the bar at any width.

  Below 1000px the bar now gives up the two labels a phone already did, the
  words on the back button and the line under "Mars Yard", and the page links
  stay a row of pills set a little closer: an operator changes station more
  often than they do anything else up there, and the phone's menu costs a tap
  each time. At 768 the chip reads "Rover online · queue 12" whole. The chip
  is also the one item in the bar allowed to shrink. Its words come from the
  rover, so a status longer than the bar was counted for shortens to an
  ellipsis beside its dot where it used to widen the page.

  A phone's bar has no row of links to take room back from. With the rover
  online and a queue its row is about 420px, so at 375 wide and under the page
  scrolled sideways, and from there to 414 it fitted only because the menu
  button had been squashed from 40px to as little as 22. What goes now, at
  440px and under, is the name. The rover tile beside it is the same mark and
  the same link home, and the status is what an operator opens the page to
  read, so it stays whole from 320 wide up. Two other cuts were mocked up
  beside it on 13 October, both keeping "Mars Yard" and taking the room out of
  the status: shorter words ("Online · 12"), or the dot and the count alone,
  which cannot tell offline from degraded. The menu button no longer shrinks
  at any width, and with that settled the chip's ellipsis applies on a phone
  too, as the last resort it is on a tablet. The name is clipped rather than
  removed, so a screen reader still has a name for the link.

- **A mission's page is a feed of everything there is to watch.** The
  simulation and the rover's videos shared one frame with arrows, the rover
  first and the simulation last, so a mission with a video hid its simulation.
  David opened one on 10 October and could not find it. It was the second time
  one of the two went missing behind a control (in August it was the rover,
  behind a dropdown), so now nothing chooses: one tile each, the simulation
  first and then every time a rover drove it, newest first. The feed is the
  one thing on the page that scrolls.

  Each tile is the shape of its picture: the simulation's is the yard's, a
  video's is 4:3, which is what the yard's camera records. Two earlier cuts
  put them in frames of other shapes and filled the difference, first with
  black bars beside the yard and then with a card of small print. From a
  tablet up the feed is a column as wide as the simulation and the first video
  need to both be in view, the rule Create Mission's simulator column already
  follows, and the code is beside it.

  A laptop's window is short and wide, and that column made the pictures
  thumbnails beside a thousand pixels of code. So where a window has the room
  the page is three columns: the simulation as tall as the page, the rover's
  videos in a column of their own that scrolls down, and the code. A first
  answer laid the feed on its side, the simulation and the first video at one
  height with more videos off to the right. A list that runs sideways is not
  something a mouse wheel finds, and two pictures of fixed shape side by side
  left a strip of nothing under them that grew with the window. A mission no
  rover has driven was getting that layout too, and drew its one simulation at
  half size in an empty column; it has the simulation at full height beside
  the code now. `lib/missionLayout` decides which arrangement a window gets.

  A pill says how many videos are still to come and takes the learner to the
  next one. It is there for as long as there is one less than half in view,
  and comes back when they scroll back; at first it went for good at the first
  scroll. Where the feed is a column and there is more than one video, the
  next one's caption shows under the first and the pill sits on it.

  On a phone the code is a bar under the simulation, closed while there are
  videos under it to find. Open, it takes the room the videos had and the
  simulation holds still above the line it is running. With no video it starts
  open, the other half of the screen as it always was.

  "How did it go? Remix it to go further or fix it." was a full-width banner
  above the player with the Remix button it was about at the far end of the
  row above. The banner is gone. The operator's note and Remix are together,
  in one of three places. On a phone, a bar at the foot of the page. From a
  tablet up, the foot of the code's card, where the note is shown whole
  however long it is. In three columns with one video, under that video: it
  is all in view, and what is left of its column would otherwise be empty, so
  the note takes it as a card with Remix inside. With several videos the
  column is all videos and the two stay in the code's card. With no note yet
  the slot says "No operator note yet" and then points at Remix, so it always
  says whose it is.

  On a phone the simulation's tile is the size of a video's, 4:3, so the two
  can be held against each other one above the other. At the yard's own shape
  it was half as tall again as the rover's video beneath it. The yard is
  nearly square, so there it is drawn about 1.4 times as wide as it is; a
  mission with no video keeps the yard's shape.

  The dot on the simulation's badge while it plays no longer pushes the map
  icon off the centre of its circle.

- **David's MacBook satellite mode, merged from upstream.** His three commits
  (MacBook mode, the `mac-env/` ignore, and the bash 3.2 fix to
  `start-mac.sh`) are now in this fork's history, so handing the repo back is
  a fast-forward. The fork had grown its own Mac webcam fallback in
  `camera_server.py` in July, so his separate `mac_camera_server.py` was not
  kept: two camera servers would fight over port 8890 and the device. What the
  fork lacked came across instead. His camera list by name is
  `camera_devices.py`, offered as a dropdown on Settings (his was on
  `/status`, which became Settings). `start-mac.sh` and
  `yard/MACBOOK_SETUP.md` are his, updated for port 3001, and the script asks
  the web server to start the camera so Settings can switch it. His changelog
  is kept in full at the end of this file.

  The Settings camera card lost its device-number field. On the Pi it did
  nothing, and elsewhere nobody knew what the number meant; a Mac gets names,
  anything else uses camera 0 or `CAMERA_INDEX`. The camera picked there was
  also being saved and never read back, so every restart went back to camera
  0. It is restored at startup now.

- **Firestore backups, in Terraform** (`infra/modules/firestore-backup`). A
  weekly Cloud Scheduler job calls the managed `:exportDocuments` API and
  writes to `gs://bt-impact-academy-firestore-backup`, kept 90 days. The
  bucket sits in `europe-west1` with the database, not in `africa-south1`
  with everything else, because an export will not write away from its
  database. Point-in-time recovery and delete protection are on the database
  as well, set out of Terraform alongside the rest of the Firebase config.

  The job runs in `europe-west1` too, on the shared `cron_region` from #182,
  because Cloud Scheduler is not offered in `africa-south1` at all. So nothing
  in this module sits in the region the app runs in, for two unrelated
  reasons.

  This replaces a proposed Cloud Function that walked collections to JSON and
  uploaded a zip to a personal Google Drive folder. That version turned
  timestamps into strings and references into maps, and its restore wrote them
  back that way, so a restore would have reported success and reshaped the
  schema. Restore procedure is in `docs/RUNBOOK.md` §8 and is still unproven.

- **The prod smoke check asserts the operator boundary, from the same script
  as staging** (`scripts/smoke-check.sh`). `deploy-prod.yml` had never been
  run, and still ended by asserting that `/operator` was a 404, the line
  staging dropped in #93 when the console shipped. Prod promotes the digest
  serving on staging, so the first production deploy would have deployed
  correctly and then gone red. The check lived in two workflows and only one
  was fixed, so it now lives in one script both call, and
  `architecture.test.ts` fails if either workflow grows its own again. The
  script's failing paths are tested against a stub server for the first time:
  until now nothing had ever shown it would notice a leaked console.

---

## 2026-08-31 to 2026-09-03 - The yard hands its console to Mission Control

Mission Control had grown an operator console the week before (see
2026-08-26 below), which left the satellite running a second one, and a
Firestore mirror to feed it, for a yard that had moved to copy and paste. Both
went. `yard/docs/what-the-yard-no-longer-does.md` records what the mirror did,
and the cheaper shape a way back should take.

- **The satellite's mission queue page went** (#138). It needed a Firebase
  sign-in, and so an internet connection, before an operator could do the one
  thing a yard has to be able to do offline.
- **YouTube auto-linking moved from the satellite to Mission Control** (#140).
  On the satellite the poll only caught up when that yard next ran an event,
  and it put a YouTube key on a Pi on venue wifi. It is now
  `POST /api/cron/youtube-link`, called by Cloud Scheduler whether or not any
  yard is switched on. The same PR added `/operator/settings`, an admin page
  for the email and YouTube config that used to need a Terraform run.
- **Yards became data** (#141). An admin adds, edits and retires them, and an
  operator's yard is bound to their sign-in.
- **The operator console became a mission centre** (#142), and the linker
  learned to take the yard from the video instead of guessing which run it
  belongs to.
- **A run station at `/run/`, and a station hub at `/`** (#143). Paste a
  mission copied from Mission Control, send it, record it, and take the video
  away over the LAN: the whole of the yard's manual loop.
- **The satellite stopped asking for a sign-in** it cannot do offline, or does
  not need (#145).
- **Send starts the recording, and the rover's own completion stops it**
  (#146). The dispatch carries `mission_id`, the rover echoes it back in its
  history, and `mission_watcher` closes the recording when it sees the run
  end.
- **The Firestore mirror taken out of the satellite** (#146, 2026-09-02).
  Gone: `sync_worker.py`, the SQLite mirror and outbox (`store/` and its
  `mission_store.py` facade), `recovery.py`, `ports.py`, the satellite's
  YouTube poll, the console's `auth`, `deps`, `missions`, `review`, `mirror`,
  `notify` and `health` modules, and the mission and login pages: thirty
  files and about 9,900 lines, tests included. The satellite now holds no
  cloud credential. `mission_watcher` stayed, cut down to releasing the
  camera, and the camera and tunables endpoints kept their `/operator/`
  prefix so the pages and tablet bookmarks that call them still work.
- **Every run keeps its own video** (#153). Recordings are named
  `<mission>__<yard>__<UTC stamp>.mp4`, because re-running a mission used to
  overwrite the footage of the attempt before. The same PR made Mission
  Control's Copy one payload everywhere, with the mission's name and id in
  Python header comments that the run station reads.
- **A YouTube Studio link from the operator queue** (#157), the same door the
  run station ends on.

## 2026-08-30 - Code quality overhaul

Response to the iteration 2 coding marksheet (32.3/56), which said the
organisation "does not reflect a clear or coherent approach to dividing
responsibilities", that object-oriented principles and separation of concerns
needed strengthening, and that the code was difficult to follow.

- **Root decluttered, 34 entries to 15** (#122). Everything inherited from the
  upstream 4tronix desktop simulator moved to `legacy/`, nothing deleted. Four
  one-shot planning docs archived to `docs/plans/`. README rewritten to
  describe this project rather than PyQt6 setup.
- **The 4tronix rover library vendored** into `yard/rover/vendor/` (#122), so
  the rover Pi needs one clone rather than two. Partial by necessity:
  `rover.py` imports `pca9685`, which 4tronix's own installer provides and
  which is not in this repository, so `/home/mars/marsrover` still has to
  exist. See `yard/rover/vendor/README.md`.
- **`/home/mars` removed from Python** (#122). The rover library path is now
  derived from the module's own location, overridable with `ROVER_LIB_PATH`.
  The marksheet named this one directly.
- **Rover command table and `StudentCodeRunner`** (#123). `_execute_instruction`
  went from 130 lines to 58: six identical drive-wait-stop branches collapsed
  into one table, and the learner-Python sandbox moved to `python_runner.py`.
- **The satellite got its first interfaces** (#124). `ports.py` states the
  Firestore shape the satellite depends on as `typing.Protocol`. Until then
  the satellite declared no abstraction of any kind, and the evidence was 22
  `Fake*` classes across its tests, most of them the same class twice. One
  shared implementation replaced them in
  `yard/satellite/tests/firestore_fakes.py`. Both files went with the mirror
  on 2026-09-02.
- **The operator console split, 1399 lines to 75** (#125). Its 23 routes moved
  into six route modules under `yard/satellite/console/`, one concern each,
  beside four more for shared concerns (`deps`, `mirror`, `notify`,
  `blueprint`).
  The Flask route table was diffed against `main` after every step and never
  changed.
- **Mission Control's dependency arrows reversed** (#126). `core` no longer
  imports `infrastructure` anywhere: safety rules moved into
  `core/domain/safety`, DTOs into `core/application/dto`, the email body
  behind a port. The repository interface widened to cover what routes
  actually do, and one composition root replaced seven inline constructions.
- **Architecture tests added** (#126). `tsc` is happy whether core imports
  infrastructure or not, and every behavioural test passed throughout the
  period when the arrows were backwards. `architecture.test.ts` asserts the
  layering rules so they fail the build instead of a marksheet.
- **A security-relevant bug caught by CI, not by review** (#126). A first
  version of the composition root put the Firebase Admin SDK and the browser
  SDK in one module, which pulled the Admin SDK - the one that bypasses
  Firestore rules entirely - toward the browser bundle. Split into
  `container.server.ts` (with `import 'server-only'`) and
  `container.browser.ts`.

## 2026-08-30 - Learner safety and the editor

- **Time and speed ceilings** (#119, #120). A mission cannot exceed 120
  seconds, and speeds are capped at 0-100. The marksheet noted a comment
  describing a 0-100 range that nothing enforced; it is now enforced in three
  places, including at the rover's LAN boundary where nothing else guards.
- **Mission names became a closed vocabulary** (#116). Names are generated,
  never typed. They land on a world-readable document, and 47 of the first 400
  carried names the generator could not have produced.
- **The editor says where a mistake is and what to do** (#111), and the
  generated Python explains itself (#112).
- **Turns are measured in degrees** (#114), which is what made drawing a
  square possible; the simulator got working lamps and a yard big enough to
  drive in (#113).
- **Nested corner radii made concentric** (#121).

## 2026-08-26 to 2026-08-29 - Runs, roles, and the operator console

- **A mission is a program; a run is one yard's attempt at it** (#91, #99).
  Any yard may run any mission, each attempt keeps its own status and video,
  and the mission-level lease was deleted because the contention it
  arbitrated no longer exists.
- **Operator auth in Mission Control** (#87, #89). Protected routes and
  sign-in, closing AB#341 and AB#342. The staging smoke check then asserted
  the operator boundary instead of its absence (#93).
- **Roles moved onto the token claim, scoped by yard** (#90), and operators
  choose a yard at sign-in (#92).
- **Operator access managed in the app** (#94, AB#435). `/operator/team`,
  where an admin grants, promotes, steps down or removes an operator without
  a shell.
- **Live operator queue** (#95, #97), closing AB#376, and **operator
  bookkeeping from a desk** (#108), closing AB#379: complete, cancel, attach a
  video, resolve a review.
- **PostHog analytics and session replay** (#98, #100, #101).

## 2026-08-11 to 2026-08-20 - Deployment

- **Mission Control behind an external load balancer** (#69), then pointed at
  the real domains (#73): `marsyard.sapient.rocks` for production,
  `marsyard.labs.ws` for staging.
- **Firestore access via the runtime service account** rather than a mounted
  key (#75), and the Firebase Auth grant operator login needs (#96).

## 2026-07-26 to 2026-07-30 - Offline-first, and the yard

The satellite stopped depending on the network to do its job. This is the
period that produced the satellite's Firestore mirror, which carried the yard
until it was removed on 2026-09-02 (see above).

- **SQLite mirror and outbox**: the console reads and writes local storage,
  and a sync worker reconciles with Firestore later.
- **Push before pull**: the ordering rule that stops a stale cloud copy
  erasing the fact that a rover physically moved.
- **Recovery and conflict surfacing**: a mission interrupted by a restart is
  flagged for a human rather than guessed at.
- **Camera control from the console**, with a webcam fallback when no Pi
  camera is present.
- **Learner email stored only as a hash** on the mission document.

## 2026-07-17 and 2026-07-18 - Mandela Day pilot

The first time children drove the rover. Forty-five missions ran against a
goal of twenty.

## 2026-06-20 - The UCT project begins

`mission-control` imported onto the upstream fork (#1), renamed and stripped
of bloat five days later (#18). Everything before this date is upstream
4tronix work and now lives in `legacy/`.

## 2023-05-16 - Upstream origin

The 4tronix M.A.R.S. Rover desktop simulator, by Ian Griffiths and David
Campey. Its physics model is still the reference the current simulator is
written against.

---

## Upstream history (`coderlevelup/4tronix-rover-simulator`)

David's changelog from upstream, as he wrote it, kept when his MacBook mode was
merged in. It covers the project before this fork and its version numbers.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres, informally, to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This project has no tagged releases; the version numbers below are inferred
retroactively from the commit history to group related work.

### [Unreleased]

### [0.14.0] - 2026-08-20

Contributors: David Campey

#### Fixed
- `yard/satellite/start-mac.sh` no longer relies on `wait -n`, which requires
  bash 4.3+; macOS ships bash 3.2, so the script now polls instead.

### [0.13.0] - 2026-06-19

Contributors: David Campey

#### Added
- MacBook satellite mode: webcam stream and camera picker, so a laptop can
  stand in for the satellite Pi during local dev or in a classroom without one.

### [0.12.0] - 2026-06-13

Contributors: David Campey, Manos Zeakis

#### Added
- `/status` page: component health badges, rover mast-camera detection, and
  editable rover URL.
- Resilience hardening: interruptible student code, watchdog, systemd service,
  manual updates.
- `yard/camcheck.sh` rover camera diagnostic and a worked camera-diagnosis
  method (with Heisenbug discipline) in the manual.
- Blockly Mast block category (servo turn, distance sensing, take a picture)
  and Lights block category (set all LEDs / set single LED to a colour).
- SSH + `drive.sh` fallback documented for direct rover testing.

#### Changed
- Monitor shows a "Photo failed" placeholder when `take_photo()` errors
  instead of failing silently.
- Recoloured Blockly blocks: Wait matches the Control category's orange,
  Lights category is purple.
- Test doubles renamed to match taxonomy (fake driver, spy service).

#### Fixed
- Duplicated loop-body blocks in Blockly code generation.

### [0.11.0] - 2026-03-28

Contributors: David Campey

#### Added
- `run_python` instruction type and a Python editor tab, later upgraded from
  a plain textarea to the Monaco editor.
- Blockly workspace preview and nicely rendered `run_python` code blocks in
  the monitor queue.
- "On uplink" block (renamed from "On receive"), enforced in the workspace,
  restored automatically if cleared.
- Satellite hostname and IP shown on the monitor; local IP detection fixed
  for offline networks.

#### Changed
- Monitor polling replaced with SSE push for live updates.
- Tablet UI scaled up for primary-school use.
- Camera and rover status badges prefixed with labels.

#### Fixed
- Stop button, steer direction, and SSE for remote clients (threaded mode,
  reloader disabled).

### [0.10.0] - 2026-03-25

Contributors: David Campey

#### Added
- Headless Pi imaging and WiFi setup docs, hardware assembly notes, and a
  Bookworm/Trixie upgrade plan (later simplified for the Pi Zero, with a
  Trixie-avoidance note and a boot-twitch startup animation to confirm the
  hardware is alive).
- Mast pan controls in `driveRover.py`, with smooth 1-degree increments per
  keypress and reassigned speed keys.
- Retry of rover hardware init if not ready on boot.

#### Changed
- `driveRover.py` is symlinked instead of copied onto the Pi.
- Motors stop before pivot/spin to prevent a lurch when toggling spin
  direction; `RealRoverDriver` pivots before spinning for proper wheel
  alignment and passes brightness through to `rover.init()`.

#### Fixed
- Mast pan direction (comma = left, dot = right).
- macOS workaround for generating `userconf.txt` (Pi user creation) via
  Python instead of the Linux-only tool.

### [0.9.0] - 2026-03-06

Contributors: David Campey

#### Changed
- Rover server refactored to a Ports & Adapters architecture, documented in
  the README.
- Documentation reorganized: detailed docs moved to `docs/`, READMEs
  simplified and made beginner-friendly, main README now links out to `yard`
  and the visual simulator instead of duplicating their setup steps.

### [0.8.0] - 2026-01-27

Contributors: David Campey

#### Added
- `yard` queue-based rover control system, replacing direct command dispatch
  with a queued instruction model.

### [0.7.0] - 2025-12-04

Contributors: David Campey

#### Added
- High-level command API for faster rover control.
- Directional LED indicators for movement, including a rotating green
  animation during spin commands.
- Steer left / steer right manual controls and corresponding Blockly steering
  blocks (replacing the differential-drive blocks).
- Blockly workspace persistence to `localStorage`, with tab preservation and
  a `mode` URL parameter (renamed from `tab`).

#### Changed
- Web interface split into separate pages for the real rover and the
  simulator.

#### Fixed
- LED front/rear mapping (iterated through a few wrong pairings before
  confirming the correct one).
- Steering: `forward()` is called before setting servos.
- Blockly XML API compatibility, block connections when loading from
  `localStorage`, and workspace-save debouncing (consolidated event
  listeners).

### [0.6.0] - 2025-11-28

Contributors: David Campey

#### Added
- Pi AI Camera (IMX500) streaming with on-device object detection and
  confidence-percentage bounding boxes.
- Comprehensive AI camera setup docs and systemd setup instructions.

#### Changed
- Web interface defaults to the `marspi` target.
- Setup docs use `git clone`/`pull` instead of `scp`, and the Pi user is
  `mars` instead of `pi` throughout.
- Rover server runs as root for LED hardware access.

#### Fixed
- WebSocket connection closing immediately (kept alive); handler signature
  updated for a newer `websockets` library version.
- Color inversion — camera stream converted from BGR to RGB.
- IMX500 initialization and postprocessing compatibility, worked through
  several iterations before settling on the object-detection implementation.

### [0.5.0] - 2025-11-11

Contributors: David Campey

#### Added
- HTTP interface that can target either the simulator or the real rover.

#### Fixed
- Layout and bugfixes in the web interface.

### [0.4.0] - 2025-09-22

Contributors: David Campey

#### Added
- WebRTC streaming to the simulator.
- Simple Blockly interface, and a web interface pulling video from both the
  rover and the satellite.

#### Changed
- Web interface reorganized into a sub-folder, with RTC handling refactored
  and tests organized.
- DriveRover logic updated so the rover and simulator pivot consistently.

#### Fixed
- Simulator steering logic.

### [0.3.0] - 2025-08-18

Contributors: David Campey, Manos Zeakis

#### Added
- Initial remote-control UI with a 4-instruction interface, tabbed layout,
  and an on-device camera feed later upgraded to a live stream.
- README notes for an (untested) UV4L setup approach.

### [0.2.0] - 2025-03-12

Contributors: David Campey

#### Added
- `square.py` sample script driving the rover in a square.
- Spin-on-the-spot handling in the simulator UI.

#### Changed
- Simulator screen given a Mars-themed look.

#### Fixed
- Real rover requires an `init()` call to run successfully.

### [0.1.0] - 2023-05-21

Contributors: Ian Griffiths

#### Added
- Initial visual rover simulator.
