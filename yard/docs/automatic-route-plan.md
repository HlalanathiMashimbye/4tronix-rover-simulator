# The automatic route

Plan, not implementation. The manual loop stays exactly as it is; everything
here is a layer on top of it, and the yard must still run a mission with no
internet at all.

## The constraint that decides the shape

The satellite is on mobile data behind carrier NAT. No inbound port, no
tunnel. This is stated in ROADMAP.md, docs/ARCHITECTURE.md and docs/BACKLOG.md,
and it is why the copy-paste bridge existed in the first place.

**Mission Control can never push to the yard.** "Press Run and it goes" is
still possible, but only as: Mission Control *queues*, and the yard *pulls*.
Every arrow in this plan points outward from the satellite.

That is not a workaround. It is also what keeps working when the venue wifi is
bad, because a yard that pulls can retry, and a yard that is pushed to cannot.

## 1. Claiming a yard

**Decided: the yard generates the code, the operator types it into Mission
Control.**

The claim being made is "I am physically at this yard and will oversee it". A
code that originates on the yard's own screen can only be read by someone
standing in front of it. A code generated in Mission Control could be read out
over the phone to anyone, which proves authorisation but not presence, and
presence is the whole point.

This shape is RFC 8628, the OAuth Device Authorization Grant - the flow a TV
app uses. Worth following rather than inventing.

1. The satellite boots unclaimed and shows a six-digit code on the station
   page. Short TTL, regenerated when it expires, single use.
2. The satellite polls Mission Control: "has anyone claimed me yet?" Outbound,
   so NAT is irrelevant.
3. An operator signed in to Mission Control opens the yard and enters the code.
4. Mission Control binds (yard, operator, session) and hands the satellite a
   long-lived device token on its next poll.
5. The satellite keeps that token in memory and uses it for every outbound
   call afterwards. Mission Control can revoke it, and switching the yard off
   ends it (see below).

**Decided: a claim lasts the event, a yard has one operator, and the event
ends when the satellite is switched off.**

No inactivity timeout - an operator who spends an hour with one school group
should not have to re-pair. The claim simply lives as long as the yard is
powered on.

That last part is the useful one, because it makes the lifetime
self-defining. There is no "end of day" to agree on and no backstop expiry to
pick: the yard being on is the event. A stale claim on a yard nobody released
cannot happen, because a yard nobody is at gets switched off.

It also decides the implementation. **The claim is held in memory, not written
to disk.** No token file that has to be invalidated on shutdown, nothing to go
stale on the card, and no cleanup to get wrong - turning the satellite off
clears it because there was never anywhere for it to persist. On boot the
satellite is unclaimed and shows a fresh code, always.

Mission Control learns the claim ended by the satellite going quiet: it stops
polling. A best-effort "signing off" on shutdown makes that immediate rather
than waiting for a timeout, but the timeout is what must be correct, since a
yard that loses power will never send anything.

The cost is that an accidental reboot mid-event means pairing again. That is
mild, and it is mild for the same reason the whole claim design works: the
operator is standing next to the machine by definition, so re-pairing is
reading a code off the screen in front of them. It is arguably right, too - a
reboot means the yard's state is gone, and re-establishing who is overseeing
it is not a bad thing to be forced to do.

One operator per yard means a second claim on a claimed yard is refused rather
than silently taking it over. The obvious failure - an operator whose laptop
dies, or who goes home still holding one - now resolves itself when the yard is
switched off, but an admin force-release is still worth having for the case
where the yard is on and the operator is not coming back.

The satellite never holds a Firebase credential, which is what we just spent a
removal getting rid of. It holds one token, in memory, scoped to one yard,
revocable, and gone when the power is.

## 2. Running a mission from Mission Control

Yes - and the claim from part 1 is what makes it safe, which is why the two
questions are really one design.

Plan 2.3 says never move the robot without a human. Dispatching from a browser
hundreds of kilometres away breaks that rule, unless the yard will only accept
work while an operator has claimed it and is standing there. **The claim is
the human.** No claim, no pulling, no movement.

The loop:

1. Operator presses Run in Mission Control. The run is queued against a yard.
2. The satellite, claimed and polling, picks it up.
3. It applies the readiness gate it already has - camera primed, rover
   reachable - and refuses the run if either fails, reporting why. Identical to
   what the run station does today, because it is the same check.
4. It starts recording, waits the lead-in, dispatches to the rover.
5. `mission_watcher` already stops filming when the rover reports the run
   finished. Nothing new.
6. It reports status outward at each step.

Guards worth writing down now, because they are the difference between this
being safe and being a remote-controlled robot:

- The satellite pulls work only while claimed, and stops the moment the claim
  expires or is revoked. **No claim, no movement.**
- The readiness gate is the satellite's, not Mission Control's. The yard is the
  only thing that knows whether its camera is producing frames.
- Refusals travel back. A run Mission Control believes is running, and the
  yard refused, is worse than no automation.

## 2a. Stopping

**Decided: there is no remote stop.** Mission Control can start a run at a
yard. It cannot halt one.

That is the stronger position, not the weaker one. There is exactly one stop,
it is the button at the yard, it is a LAN call to the rover, it is immediate,
and it works with no internet. Nobody has to reason about which stop is
authoritative or what happens when the network takes one of them away. Plan
2.3 is satisfied by the person standing next to the rover, which is who the
claim in part 1 says is there.

This decision also simplifies part 2 considerably, and it is worth being
explicit that it does, because the previous draft of this plan argued for a
held-open outbound channel - a long poll or an SSE stream - purely to get a
remote stop delivered in under a second. With no remote stop there is nothing
left that is latency-critical:

- Dispatch tolerates seconds. A mission arriving three seconds after Run was
  pressed is indistinguishable from one arriving instantly.
- So **a plain poll is enough.** No held connection, no stream, no reconnect
  logic, no server holding requests open per yard.

A poll every few seconds, outbound, with the device token. That is the whole
transport.

**When the network drops mid-run** the satellite keeps the current run going
and stops picking up new work. The rover is fine and the operator is standing
next to it with the only stop that exists. Halting a physical run because a
network blipped is its own hazard.

## 2b. Queueing at an unclaimed yard

**Decided: refuse.** Run is unavailable for a yard nobody has claimed, rather
than queueing something that fires later.

The important part is that refusing at queue time is not enough on its own.
A run can be queued at a claimed yard and then sit there while the claim ends -
the operator packs up, or the yard is switched off, which is now the same
thing. If nothing re-checks, the run is dispatched at a yard nobody is
watching, which is precisely what refusing was meant to prevent, just delayed
by ten minutes.

So the claim is checked twice:

- **At queue time**, in Mission Control, so the operator gets told immediately
  rather than watching a run sit in a queue that will never move.
- **At dispatch time**, on the satellite, which will not pull work unless it
  is claimed. This is the one that actually matters, because it is the check
  standing between a browser and a rover.

And a run already queued whose yard loses its claim goes back to the operator
rather than waiting. A queue that quietly holds runs for a yard that has gone
home is how someone arrives in the morning, switches a yard on, and watches it
start driving.

Mission Control's operator console already has the idiom for this: an action
that cannot run right now is shown greyed with the reason, not hidden. See
`consoleMode.ts`, which does exactly that for actions handled automatically.
"Nobody has claimed this yard" is the same shape of message.

## 3. Getting the video up

**Decided: keep this abstract for now.** The loop is worth automating before
the upload is, and the upload has a credential problem nobody has solved yet.

So part 3 is a seam rather than an implementation: once a recording is
finished, the satellite hands it to a **handover step**. Today that step is
what already exists - the operator picks the file on the run station, saves it
and uploads it themselves, and Mission Control links it by the MissionID and
Yard lines. Later, the same seam can upload directly without anything above it
changing.

Designing the seam now costs nothing and keeps the decision open. Building the
upload now means solving the credential problem first, and that problem is
larger than it looks.

### The prerequisite, when it is time

Mission Control holds `YOUTUBE_API_KEY`, which is read-only and cannot upload.
There is no OAuth client, no refresh token and no `videos.insert` plumbing
anywhere in this repository - I checked both sides. **Nobody can upload
anything today.**

So whoever ends up uploading, somebody first has to set up a YouTube OAuth
client and authorise the channel, and that should be proved by hand on its own
before any code depends on it.

When it is built, the shape worth aiming at is Mission Control minting a
resumable upload session and handing the satellite the session URI, so the
bytes go straight up without a credential ever landing on the Pi. The prize is
not the automation itself: Mission Control would know the video id at upload
time, which **retires the YouTube poll entirely** - currently around 79% of the
quota bill, and growing with every completed mission, purely because nothing
tells the platform which video belongs to which run.

(Also outstanding from earlier: the `YOUTUBE_CLIENT_SECRET` and
`OPERATOR_SESSION_SECRET` printed in a session transcript still need rotating.)

## What stays as it is

- The run station, the copy-paste path, the readiness gate, the recording, the
  watcher. All of it. Automation is additive.
- The satellite still works with no internet. A yard that cannot reach Mission
  Control falls back to the manual loop rather than stopping.

## Suggested order

1. Claim and device token. Nothing else can be attributed to a yard without it.
2. Outbound status reporting, with the on-disk queue for offline. Prove the
   channel with information that does not move a rover.
3. Pull and dispatch, behind the claim and the readiness gate. A plain poll,
   because with no remote stop nothing here is latency-critical.
4. The handover seam, with the manual step behind it. Automating the upload
   later then changes one implementation and nothing above it.

Note that the claim check in step 3 is not only Mission Control refusing to
queue. The satellite refusing to pull is the check that matters; the Mission
Control one is a courtesy so the operator finds out immediately.

Each step is useful on its own, and each one leaves the manual loop intact if
the next never gets built.

## Still open

- How long may the satellite go quiet before Mission Control treats the claim
  as gone? Long enough to ride out a wifi drop, short enough that a yard
  switched off does not look claimed for the rest of the afternoon.
