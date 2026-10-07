# The real yard, measured

Measured on 5 October 2026 from five phone photos taken on 3 October
(AB#463), and corrected the same day for AB#464 (see
[Corrections](#corrections)). One number was taped: the width, 2.33 m.
Everything else is scaled from it and comes from the photos, and
[`yard-measurements/measure_yard.py`](yard-measurements/measure_yard.py)
reproduces all of it from the originals.

![The yard from above, with its rocks, start spot and high ground](yard-measurements/yard-map.jpg)

*Left: the photos straightened into a top-down map, as the yard was at 15:52
with the rover on its start spot. Right: where the ground rises (red) and
dips (blue), from a stereo pair taken at 14:27, when R4 was sitting on the
seam. That is the blob above its circle. [`yard-top-down.jpg`](yard-measurements/yard-top-down.jpg)
is the left half without the markings.*

## Directions and coordinates

The backdrop wall is **north** and the door is **west**. The photos were taken
from the south.

Positions are in cm from the west wall (x) and from the back wall (y), as on
the map's grid. The simulator reads these numbers as they are, from `YARD` in
`mission-control/src/lib/rover-physics.ts`, and `yardMeasurements.test.ts`
fails if the two ever disagree.

## The yard

| What | Value | How sure |
|---|---|---|
| Width, west to east | **233 cm** | Taped. The rover in the photos makes it 233 to 236.5 |
| Depth, north to south | **249 cm** | Photos only, within about 2 cm. The front wall hides the last strip of floor from the camera, so if anything it is a little more |
| Seam between the two floor boards | 121 cm from the back wall | Photos, within 1 cm |
| Door | The southern half of the west side, from the seam to the front wall | Confirmed by the team |
| Start | **The middle of the seam: x 116.5, y 121, facing south** | The team's choice. In the photos the rover sat at x 112, y 119 |
| Start mark | **A cross, arms 14 cm from the centre** | Not taped yet: see [The start mark](#the-start-mark) |

## The start mark

Every mission in the simulator starts on the middle of the seam, facing the
front wall (AB#465). A rover put down anywhere else runs a different mission
from the one the learner watched, so the spot is taped on the floor, and both
run pages remind the operator to use it, beside their Send buttons.

**Taping it** (once, with a tape measure and green tape if there is some: the
simulator draws the mark green):

1. Find the middle of the seam: 116.5 cm from the west wall, the door side,
   measured along the seam. It is the same from the east wall.
2. Tape a cross there: one strip along the seam and one across it, each
   28 cm long and centred on the spot, so every arm is 14 cm.

A cross and not an arrow: an arrow reads as "drive this way", and a mission
can just as well start by reversing.

**Using it**, before every run: the rover's centre, between its middle
wheels, over the middle of the cross, facing the front wall. Parked like
that, all four tips of the cross show, about 4 cm past the rover on each
side, which is what centres it.

The simulator draws the same mark at the same size, so what a learner sees
under the rover on screen is what the operator sees on the floor.

## Checking the crash check at the next visit

Since AB#466 the simulator stops the rover at a rock (each rock a circle as
wide as its largest measured side, the rover its 20 x 18.5 cm footprint) and
a learner cannot send a run that hits one. Whether the real rover agrees is
the last part of that story, and these three runs answer it. Put the rover on
the start mark for each, paste the code into the run station, and write down
what happened next to what the simulator says:

| Run | Code | The simulator says |
|---|---|---|
| A, a near miss | `rover.forward(60)` `time.sleep(5)` `rover.stop()` | Passes R4, about 3 cm clear |
| B, head on | `rover.spinLeft(60)` `time.sleep(1.4)` `rover.stop()` `rover.forward(60)` `time.sleep(4)` `rover.stop()` | Hits R4 at 2.1 s |
| C, a glancing blow | `rover.spinLeft(60)` `time.sleep(0.7)` `rover.stop()` `rover.forward(60)` `time.sleep(4)` `rover.stop()` | Clips R4 with a front corner at 1.1 s |

A disagreeing with the simulator is the most likely, and the most useful to
know: 3 cm is about what a turn's drift and the hand placing the rover can
add up to, so if the real rover clips R4 there, the rocks need a margin.

## Rocks

All four stay where they are. Sizes are as seen from above; heights were not
measured.

| Rock | x, y | Size |
|---|---|---|
| R1, long and dark, against the backdrop | 62, 16 | 30 x 5 |
| R2 | 138, 25 | 13 x 17 |
| R3 | 206, 50 | 20 x 24 |
| R4, the big one | 141, 133 | 23 x 23 |

R4 is in three different places across the photos: west of the middle at
14:19, on the seam at 14:27, and where the table puts it at 15:52. It was
moved while the photos were being taken. The team confirmed the 15:52 spot is
where it belongs.

## The ground

**Two mounds in the middle**, with their peaks at (94, 94) and (84, 137): the
two bright spots with rings of cracked texture around them. The start is
33 cm east and 16 cm north of the southern peak, so **the rover starts on that
mound's north-eastern slope**, not on level ground.

How high they are is not known. The stereo finds them in every pair of photos
tried, but when this was first measured, scaling its answer to centimetres
gave anything from 5 to 24 cm depending only on the feature detector's
settings.

The stereo also hints at raised back and west edges and a dip on the east
side. Those did not survive the same settings check, so they are not recorded
here as facts.

### Slope zones (AB#468)

What the simulator draws as rising ground: yellow, then orange, then red at
the top. **Drawn by eye** from the rings of cracked texture round each peak in
the floor photo, not measured, because the heights are not known (above).

Only round the peaks. The whole mound rises gently and the start is on it, so
a zone over the whole mound would flag every mission before it had moved. The
start is 35 cm from the nearer peak, outside the yellow ring. The zones are
judged at the rover's centre.

A zone changes nothing in the physics: the simulated rover drives over it as
if flat. It is a warning that from there the real run may not match: it may
drift, slip, tip or stall. Never a block, red included (the team's call on
6 Oct 2026).

| Zone | Level | x, y | Radius |
|---|---|---|---|
| North peak | red | 94, 94 | 8 |
| North peak | orange | 94, 94 | 17 |
| North peak | yellow | 94, 94 | 26 |
| South peak | red | 84, 137 | 8 |
| South peak | orange | 84, 137 | 17 |
| South peak | yellow | 84, 137 | 26 |

These are the built-in zones. A yard's layout can be changed on the settings
page, and once saved that copy is what the simulator uses for that yard.

## The simulator's floor

The simulator draws the yard on a photo of its floor (AB#464), which the
script writes to `mission-control/public/yards/curiosity/floor.webp`. No
single photo would do: the ones without the rover were all taken before R4
reached its spot. So it is the 15:52 photo, the only one with every rock where
it stays, with the rover lifted out using a photo taken before it was put
down, and the strip at the front that photo cut off filled from the others.
Each borrowed photo's colours are matched to the 15:52 one on floor both can
see, so the joins do not show.

## How it was measured

Five photos from an iPhone 13, committed in
[`yard-measurements/photos/`](yard-measurements/photos/) as they came off
the phone, with only the GPS location removed from their metadata. The
script runs on them with no arguments; its docstring says how to set it up
and has the detail. In short:

1. **Width.** Taped. The rover (185 x 200 mm) is in one photo and checks it:
   that photo is matched into the one wide shot that shows all four floor
   corners, the back half of the floor is straightened, and the rover's size
   in it gives the width again, within 1.5% of the tape.
2. **Depth.** A rectangle seen through a known lens can only have one aspect
   ratio, so the phone's own lens gives north-south without a ruler. The
   floor's corners come out at 89.3 degrees, which checks both that they were
   picked in the right places and that the floor is a rectangle. For the back
   half, the lens and the rover agree to within 2 cm.
3. **Positions.** Every photo is straightened into the same coordinates,
   matched on points on the floor only, and the rocks, the seam and the rover
   are read off a 1 cm grid. The rover measures 18.5 x 20.3 cm on that map,
   which is its real size.
4. **The ground.** There is no depth map in the photos (the phone saved only
   an HDR gain map). Photos taken seconds apart from different spots are a
   stereo pair, though: the middle of the floor is taken as flat, and
   anything that moves differently from it between the two photos is above or
   below it.

To check how far to trust each number, the whole thing was rerun with six
different feature-detector settings. The rover's width moved between 233.2
and 236.5 cm and the mound peaks by up to 3 cm. Depth and the seam do not move
at all, because they come from the lens, the hand-picked corners and the
tape, none of which the settings touch.

## Corrections

The first version of this page (AB#463) matched each photo into the wide shot
on every feature the two had in common. Many of those were on the backdrop,
which is flat and full of texture, and they pulled the match off the floor:
one photo came out about 11 cm out in the middle of the yard. It was caught
when that photo's pixels were patched into another for the simulator's floor
and the seam between the floor boards did not line up. Matching on the floor
alone, and scaling everything from the tape rather than the rover, moved:

- the mound peaks by 10 to 15 cm, from (95, 84) and (86, 122), onto the bright
  centres that can be seen in the photos;
- R1 by 5 cm and R2 by 2 cm, and the rocks' sizes by up to 4 cm;
- the seam by 1 cm, and the start spot with it.

## Limitations, and two minutes at the next visit

- **North-south is from the photos only.** Run a tape along the west wall.
- **No heights.** Hold a ruler on each mound peak and on each rock.
- **Positions along the back** sit on the backdrop's curved sweep, which
  rises, so they may be a centimetre or two off.
- **The start mark is not taped yet.** Ten minutes with a tape measure:
  see [The start mark](#the-start-mark).
- **The floor photo has the rover patched out.** A photo straight down with
  the rover out of the yard would replace the patch.

## What this changes

The simulator used a 240 x 180 cm yard that was picked for how it looked: 7 cm
too wide and 69 cm too short, so it called the edge too early going north or
south. Since AB#464 it drives in this yard, drawn north up on its floor photo,
with the rover starting on the seam facing south, so down the screen. These
numbers are also the input to AB#465 (marking the start spot), AB#466
(catching crashes into rocks and walls) and AB#468 (zones and rocks per yard).
