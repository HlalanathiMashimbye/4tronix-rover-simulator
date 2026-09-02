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
5. The satellite stores that token in its config and uses it for every
   outbound call afterwards. Mission Control can revoke it.

The satellite never holds a Firebase credential, which is what we just spent a
removal getting rid of. It holds one token, scoped to one yard, revocable.

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

## 2a. Stopping, which is a different problem

Dispatch can tolerate a few seconds. A stop cannot, and treating them as one
mechanism is how you end up with a rover you cannot halt. They are separated
here deliberately.

**The stop at the yard is the safety control.** It is a LAN call from the
station to the rover, it is already immediate, it works with no internet, and
nothing in this plan may weaken it. That is the stop that matters, pressed by
the person who can actually see the rover.

**The stop in Mission Control is a convenience, and must never be relied on as
the safety one.** It travels over the internet to a box behind carrier NAT. If
the venue wifi drops, it is gone - so a design that treats it as the real stop
has, at the worst possible moment, no stop at all.

Making the remote one prompt is a channel question, and it decides the shape of
part 2 as well:

- A plain poll every few seconds gives a stop latency of up to that interval.
  Too slow for a moving robot, and dropping the interval to a second to fix it
  wastes a request every second of every day to carry nothing.
- **A held-open outbound request - long poll, or SSE from Mission Control -
  gives roughly network round-trip, typically well under a second.** It still
  originates at the satellite, so NAT is still irrelevant, and it carries
  dispatch and stop over the same connection. This repository already proxies
  SSE from the rover to the monitor, so the pattern is not new here.

So: one held-open outbound channel, carrying both. Not two mechanisms.

**When the channel drops mid-run**, the satellite should keep the current run
going and stop accepting new work. The rover is fine, the operator is standing
next to it with the local stop, and halting a physical run because a network
blipped is its own hazard. Reconnect, re-announce, carry on.

## 3. Getting the video up

The best shape puts no credential on the Pi:

- Mission Control creates a **YouTube resumable upload session** and hands the
  satellite the session URI.
- The satellite PUTs the file straight to that URI. No double transfer through
  Mission Control, and no upload credential on a box in a science centre.
- Mission Control knows the video id at creation time, so it can attach it to
  the run itself.

The last point is the big one: **it retires the YouTube poll entirely.** That
poll is roughly 79% of the current quota bill and grows with every completed
mission, purely because nothing told the platform which video belonged to which
run. If the platform starts the upload, it already knows.

Fallback if the session handoff turns out not to work as expected: the
satellite POSTs the file to Mission Control and Mission Control uploads it.
Costs a double transfer, keeps the credential in one place, still retires the
poll.

**Decided: prove the OAuth by hand before building any of this.**

### The prerequisite nobody has yet

Mission Control holds `YOUTUBE_API_KEY`, which is read-only and cannot upload.
There is no OAuth client, no refresh token and no `videos.insert` plumbing
anywhere in this repository - I checked both sides.

So **whoever uploads, somebody first has to set up a YouTube OAuth client and
authorise the channel.** That is the single largest unknown in this plan and
the thing most likely to be discovered late. It should be proved on its own,
by hand, before any of part 3 is built.

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
3. The held-open channel, carrying stop first and dispatch second. Stop is the
   one with the latency requirement, so build it against that requirement
   rather than discovering it afterwards.
4. Pull and dispatch, behind the claim and the readiness gate.
5. Upload - only after the OAuth prerequisite has been proved by hand.

Each step is useful on its own, and each one leaves the manual loop intact if
the next never gets built.

## Open questions

- How long does a claim last, and does it survive a satellite reboot mid-event?
- Should a remote stop also end the recording, as the local one does?
- Does one operator claim one yard, or can a yard be claimed by a team?
- Do we want Mission Control to be able to queue a run at an unclaimed yard and
  have it wait, or should it refuse until somebody is there?
