# 4tronix M.A.R.S. Rover: Mission Control

A remote-driving platform for the 4tronix M.A.R.S. Rover, built for UCT's
INF4027W course. A learner writes a mission in a browser (Blockly or Python),
it runs on a real rover in a physical yard, and the learner watches the video.

The system has three deployable parts:

| Service | Where it runs | What it is |
|---|---|---|
| **Mission Control** (`mission-control/`) | Cloud Run | The learner-facing Next.js app: write a mission, watch it run, browse history |
| **Yard satellite** (`yard/satellite`) | A Raspberry Pi in the yard | Operator console, camera control, offline-first sync to Firestore |
| **Rover server** (`yard/rover`) | A Raspberry Pi on the rover | Runs the mission's Python against the rover's motors, servos and LEDs |

Cloud infrastructure (Firebase, Cloud Run, DNS) is defined in `infra/`
(Terraform). [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) covers how the
three parts fit together and how the layers inside each map to MVC;
`yard/docs/architecture.md` goes deeper on the yard alone.

## Running it locally

```bash
npm install      # first time only; a postinstall hook also installs mission-control/
npm run dev      # start hub + satellite + rover, then open 3000 and 3001
```

| Service | URL |
|---|---|
| Mission Control (`mission-control`) | http://localhost:3000 |
| Yard satellite UI | http://localhost:3001 |
| Rover server | http://localhost:8523 |

Run a single service with `npm run dev:control`, `npm run dev:satellite`, or
`npm run dev:yard`. The satellite port can be overridden with the
`SATELLITE_PORT` env var. `FakeRoverDriver` is selected automatically when no
real rover is reachable, so the full loop (submit, dispatch, run, video) works
on a laptop with no hardware.

## Documentation

Start with these three. They exist so this project can be picked up without
the people who built it (AB#358).

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) - how the system is shaped,
  and why. Read the constraints in the roadmap first.
- [`ROADMAP.md`](ROADMAP.md) - where it is going, what is deliberately
  deferred, and the known gaps
- [`CHANGELOG.md`](CHANGELOG.md) - what has happened, and why each change was
  made

Then:

- [`docs/RUNBOOK.md`](docs/RUNBOOK.md) - operating the deployed system
- [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) - what is and isn't covered
- [`docs/BACKLOG.md`](docs/BACKLOG.md) - open work, referenced by ID from code
  comments across the yard
- [`mission-control/README.md`](mission-control/README.md),
  [`yard/README.md`](yard/README.md), [`infra/README.md`](infra/README.md) -
  setup and structure for each part
- [`docs/INF4027W_Team06_Iteration2_ReadMe2026.md`](docs/INF4027W_Team06_Iteration2_ReadMe2026.md) -
  the iteration 2 submission readme for markers

## Legacy upstream simulator

This repository began as a fork of the original 4tronix M.A.R.S. Rover
desktop simulator (a PyQt6 app plus Raspberry Pi web tooling). None of that
code runs as part of the platform above; it's kept for provenance and because
the rover's physics model is still specified by reading it. See
[`legacy/README.md`](legacy/README.md) for what's there and why.
