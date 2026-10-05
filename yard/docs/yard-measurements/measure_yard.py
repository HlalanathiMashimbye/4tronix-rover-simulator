#!/usr/bin/env python3
"""
Measures the real yard from seven phone photos (AB#463).

Nobody took a tape to the rocks or the slopes, and the one tape measurement
there is (2.33 m) is a single side. Everything else in
yard-measurements.md comes out of this script, so it can be rerun, checked
and argued with rather than taken on trust.

Needs OpenCV, which nothing else in the yard does, so use a throwaway venv:

    python3 -m venv /tmp/yardvenv
    /tmp/yardvenv/bin/pip install opencv-python-headless numpy
    /tmp/yardvenv/bin/python measure_yard.py

It reads the photos in photos/ beside it, writes the two figures beside it,
and writes the simulator's floor photo into mission-control/public/yards/.
Both can be pointed elsewhere: measure_yard.py [photos] [output folder], and
an output folder gets the floor photo too, so a trial run changes nothing.

The photos are the originals from an iPhone 13, taken on 3 October 2026, with
only the GPS location removed from their metadata. Keep them that way:
screenshots or messaging-app copies will not do, because the points below are
read off the full-resolution originals, against their rotation tag.

THE METHOD, in the order the script runs it:

1. Width. Taped: 2330 mm, and everything is scaled from it. The rover is a
   check: it is in IMG_8558 and its footprint is known (185 x 200 mm), so
   it is a ruler lying on the floor. That photo is matched into the one
   photo that shows all four floor corners, the back half of the floor is
   straightened, and the rover's size in it gives the width again.
2. Depth. The camera's own lens gives the floor's proportions with no
   ruler at all: a rectangle seen through a known lens can only have one
   aspect ratio. That is an independent check on step 1, and the only way to
   get north-south, which nothing was measured along.
3. Top-down maps. Every photo is matched into the same floor coordinates.
4. Where the ground rises. There is no depth map in the photos (only an HDR
   gain map), but two taken seconds apart from different spots are a stereo
   pair. The floor's middle is taken as flat, and anything that moves
   differently from it between the two photos is above or below it (plane
   plus parallax). This finds the high ground; it cannot say how high.
"""

import os
import sys

import cv2
import numpy as np

# The wide shot: ultra-wide lens, from a ladder at the south side. The only
# photo with all four floor corners in it.
WIDE = 'IMG_8519.jpg'

# Floor corners in WIDE, in its full-resolution pixels. Read by eye from
# zoomed crops: where each side wall's base meets the floor, and where the
# seam between the two floor boards meets each side wall. The front pair is
# the side walls' base lines carried down to the front wall, which hides the
# last strip of floor from this camera (so the depth is if anything short).
BACK_LEFT, BACK_RIGHT = (780, 1392), (2247, 1383)
SEAM_LEFT, SEAM_RIGHT = (725, 2158), (2338, 2133)
FRONT_LEFT, FRONT_RIGHT = (654, 3150), (2458, 3125)

# The rover's wheels, outermost edges, in IMG_8558 at full resolution.
ROVER_PHOTO = 'IMG_8558.jpg'
ROVER_BOX = ((1466, 1370), (1691, 1602))   # (left, top), (right, bottom)
ROVER_WIDTH_MM, ROVER_LENGTH_MM = 185, 200  # 4tronix's published size

# The one length anyone put a tape to, along the backdrop wall.
TAPE_WIDTH_MM = 2330

# 35 mm-equivalent focal lengths, from the photos' EXIF.
ULTRA_WIDE_MM, MAIN_MM = 14, 26

OUT_PX_PER_MM = 0.4  # 4 px per cm in the top-down maps


def load(folder, name, grey=False):
    # imread applies the EXIF orientation, which is what the points above
    # were read against.
    image = cv2.imread(os.path.join(folder, name), cv2.IMREAD_GRAYSCALE if grey else cv2.IMREAD_COLOR)
    if image is None:
        sys.exit(f'Cannot read {name} in {folder}')
    return image


def intrinsics(image, equivalent_mm):
    # The 35 mm equivalent is defined on the diagonal of the full 4:3 sensor
    # frame. The square photos are crops of that frame, so they keep its
    # focal length in pixels.
    h, w = image.shape[:2]
    f = equivalent_mm * np.hypot(4032, 3024) / np.hypot(36, 24)
    return np.array([[f, 0, w / 2], [0, f, h / 2], [0, 0, 1.0]])


SIFT = cv2.SIFT_create(nfeatures=30000, contrastThreshold=0.02)


def features(image):
    return SIFT.detectAndCompute(image, None)


def matches(fa, fb, ratio=0.7):
    (ka, da), (kb, db) = fa, fb
    pairs = cv2.FlannBasedMatcher(dict(algorithm=1, trees=5), dict(checks=100)).knnMatch(da, db, k=2)
    good = [m for m, n in pairs if m.distance < ratio * n.distance]
    return (np.float32([ka[m.queryIdx].pt for m in good]),
            np.float32([kb[m.trainIdx].pt for m in good]))


def homography(fa, fb):
    """
    Maps photo a onto the wide shot b, through the floor.

    Only matches that land on the floor in the wide shot are used, away from
    its edges. Fitted to everything, the backdrop's printed photo (flat, and
    full of texture) pulled the fit off the floor: IMG_8518 came out about
    11 cm out in the middle of the yard, which was only caught when its pixels
    were patched into another photo and the seam did not line up.
    """
    pa, pb = matches(fa, fb)
    quad = [BACK_LEFT, BACK_RIGHT, FRONT_RIGHT, FRONT_LEFT]
    u = transform(pb, np.linalg.inv(unit_square_to(quad)))
    on_floor = (u[:, 0] > 0.05) & (u[:, 0] < 0.95) & (u[:, 1] > 0.1) & (u[:, 1] < 0.95)
    H, inliers = cv2.findHomography(pa[on_floor], pb[on_floor], cv2.RANSAC, 6.0)
    return H, int(inliers.sum()), int(on_floor.sum())


def unit_square_to(points):
    return cv2.getPerspectiveTransform(np.float32([[0, 0], [1, 0], [1, 1], [0, 1]]), np.float32(points))


def transform(points, M):
    return cv2.perspectiveTransform(np.float32(points).reshape(-1, 1, 2), M).reshape(-1, 2)


def lens_shape(K, quad):
    """
    The aspect ratio (depth / width) and corner angle a rectangle must have to
    look like quad through this lens. With the plane's homography G = K[r1 r2 t],
    r1 and r2 are the floor's two directions, so their lengths give the aspect
    and their angle checks that the corners really were a rectangle's.
    """
    a, b, _ = (np.linalg.inv(K) @ unit_square_to(quad)).T
    angle = np.degrees(np.arccos(a @ b / np.linalg.norm(a) / np.linalg.norm(b)))
    return np.linalg.norm(b) / np.linalg.norm(a), angle


def top_down(image, to_wide, floor_to_wide, size, px_per_mm=OUT_PX_PER_MM):
    """The photo, straightened into floor coordinates (x east, y south, from the back-left corner)."""
    out_to_floor = np.diag([1 / px_per_mm, 1 / px_per_mm, 1])
    out_to_photo = np.linalg.inv(to_wide) @ floor_to_wide @ out_to_floor
    return cv2.warpPerspective(image, np.linalg.inv(out_to_photo), size, flags=cv2.INTER_AREA)


def parallax(a, b, to_wide_a, floor_to_wide, width, depth, size):
    """
    How far each point of photo a sits off the floor's plane, as seen from the
    pair (a, b), in floor coordinates. Proportional to height over distance
    from the camera; the caller scales it.
    """
    scale = 0.5  # half resolution: plenty for 5 cm features, four times faster
    ga = cv2.resize(a, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    gb = cv2.resize(b, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    pa, pb = matches(features(ga), features(gb), ratio=0.75)

    # The plane is fitted to the floor's middle only. Fitted to everything it
    # locks onto the backdrop, which is flat and full of texture.
    floor_to_a = np.diag([scale, scale, 1]) @ np.linalg.inv(to_wide_a) @ floor_to_wide
    on_floor = transform(pa, np.linalg.inv(floor_to_a))
    middle = ((on_floor[:, 0] > 300) & (on_floor[:, 0] < width - 300)
              & (on_floor[:, 1] > 600) & (on_floor[:, 1] < depth - 300))
    plane, _ = cv2.findHomography(pb[middle], pa[middle], cv2.RANSAC, 1.5)
    F, _ = cv2.findFundamentalMat(pa, pb, cv2.FM_RANSAC, 1.0, 0.999)

    # What is left after taking the plane's motion out is parallax, and it
    # points along lines through the epipole, growing with distance from it.
    warped = cv2.warpPerspective(gb, plane, (ga.shape[1], ga.shape[0]))
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_ULTRAFAST)
    dis.setFinestScale(0)
    dis.setPatchSize(16)
    dis.setPatchStride(4)
    dis.setVariationalRefinementIterations(10)
    flow = dis.calc(ga, warped, None)
    epipole = np.linalg.svd(F)[2][-1]
    epipole = epipole[:2] / epipole[2]
    yy, xx = np.mgrid[0:ga.shape[0], 0:ga.shape[1]].astype(np.float32)
    rx, ry = xx - epipole[0], yy - epipole[1]
    r2 = rx * rx + ry * ry + 1e-6
    gamma = (flow[..., 0] * rx + flow[..., 1] * ry) / r2

    out_to_a = floor_to_a @ np.diag([1 / OUT_PX_PER_MM, 1 / OUT_PX_PER_MM, 1])
    g = cv2.warpPerspective(gamma.astype(np.float32), np.linalg.inv(out_to_a), size,
                            flags=cv2.INTER_LINEAR, borderValue=np.nan)
    seen = np.isfinite(g)
    g = cv2.medianBlur(np.nan_to_num(g, nan=0).astype(np.float32), 5)
    return np.where(seen, g, np.nan)


def box_value(g, x0, y0, x1, y1, q):
    """A percentile of g over a box given in cm from the back-left corner."""
    k = OUT_PX_PER_MM * 10
    cells = g[int(y0 * k):int(y1 * k), int(x0 * k):int(x1 * k)]
    cells = cells[np.isfinite(cells)]
    return np.percentile(cells, q) if cells.size else np.nan


# Read by eye from the top-down maps on a 1 cm grid, in cm from the west wall
# (x) and the back wall (y). yard-measurements.md's tables copy these.
SEAM_Y = 121
ROVER_AT = (112, 119)  # the rover's centre in IMG_8558/8559, facing south
ROCKS = [  # name, x, y, drawn radius
    ('R1', 62, 16, 15), ('R2', 138, 25, 9), ('R3', 206, 50, 12), ('R4', 141, 133, 12),
]


def figure(photo, heights, width_cm, depth_cm, peaks):
    k = OUT_PX_PER_MM * 10
    font = cv2.FONT_HERSHEY_SIMPLEX

    def label(out, text, at, colour, size=0.5):
        cv2.putText(out, text, at, font, size, (0, 0, 0), 4)
        cv2.putText(out, text, at, font, size, colour, 1 if colour == (40, 40, 40) else 2)

    def framed(image, title):
        top, left = 60, 50
        h, w = image.shape[:2]
        out = np.full((h + top + 40, w + left + 30, 3), 250, np.uint8)
        out[top:top + h, left:left + w] = image
        for cm in range(0, int(width_cm) + 1, 10):
            x = left + int(cm * k)
            cv2.line(out, (x, top), (x, top + h), (235, 235, 235) if cm % 50 == 0 else (170, 170, 170), 1)
            if cm % 50 == 0:
                cv2.putText(out, str(cm), (x - 10, top - 8), font, 0.45, (40, 40, 40), 1)
        for cm in range(0, int(depth_cm) + 1, 10):
            y = top + int(cm * k)
            cv2.line(out, (left, y), (left + w, y), (235, 235, 235) if cm % 50 == 0 else (170, 170, 170), 1)
            if cm % 50 == 0:
                cv2.putText(out, str(cm), (8, y + 5), font, 0.45, (40, 40, 40), 1)
        cv2.putText(out, title, (left, 24), font, 0.65, (20, 20, 20), 2)
        q = lambda x, y: (left + int(round(x * k)), top + int(round(y * k)))
        cv2.rectangle(out, q(0, 0), q(width_cm, depth_cm), (0, 0, 0), 2)
        cv2.line(out, q(0, SEAM_Y), q(width_cm, SEAM_Y), (0, 200, 255), 2)
        label(out, 'seam', q(width_cm - 28, SEAM_Y - 2), (0, 200, 255))
        cv2.line(out, q(0, SEAM_Y), q(0, depth_cm), (255, 120, 0), 6)
        label(out, 'DOOR', q(3, 186), (255, 160, 60), 0.55)
        for name, x, y, r in ROCKS:
            cv2.circle(out, q(x, y), int(r * k), (0, 255, 255), 2)
            label(out, name, q(x + r + 1, y + 2), (255, 255, 255), 0.55)
        sx, sy = ROVER_AT
        cv2.rectangle(out, q(sx - ROVER_WIDTH_MM / 20, sy - ROVER_LENGTH_MM / 20),
                      q(sx + ROVER_WIDTH_MM / 20, sy + ROVER_LENGTH_MM / 20), (0, 255, 0), 2)
        cv2.arrowedLine(out, q(sx, sy), q(sx, sy + 33), (0, 255, 0), 3, tipLength=0.3)
        label(out, 'START, facing south', q(sx - 30, sy + 42), (0, 255, 0))
        for x, y in peaks:
            cv2.drawMarker(out, q(x, y), (0, 0, 255), cv2.MARKER_TRIANGLE_UP, 22, 3)
        cv2.putText(out, 'N (backdrop)', (left + w - 125, 24), font, 0.55, (0, 0, 200), 2)
        return out

    middle = heights[int(60 * k):int(200 * k), int(40 * k):int(190 * k)]
    lo, hi = np.nanpercentile(middle, [2, 99.5])
    colour = cv2.applyColorMap(np.uint8(np.clip((np.nan_to_num(heights, nan=lo) - lo) / (hi - lo), 0, 1) * 255),
                               cv2.COLORMAP_TURBO)
    colour[~np.isfinite(heights)] = 0
    return np.hstack([framed(photo, 'Top-down, cm from the west wall and the back wall'),
                      framed(colour, 'Relative height from stereo: blue low, red high')])


FLOOR_PX_PER_MM = 0.6  # 6 px per cm: sharp at twice the size the simulator draws it


def clean_floor(folder, to_wide, floor, width, depth, path):
    k = FLOOR_PX_PER_MM * 10
    size = (int(round(width * FLOOR_PX_PER_MM)), int(round(depth * FLOOR_PX_PER_MM)))

    def straightened(name):
        image = load(folder, name)
        seen = np.full(image.shape[:2], 255, np.uint8)
        return (top_down(image, to_wide[name], floor, size, FLOOR_PX_PER_MM).astype(np.float32),
                top_down(seen, to_wide[name], floor, size, FLOOR_PX_PER_MM) > 250)

    def cm_box(x0, y0, x1, y1):
        box = np.zeros((size[1], size[0]), bool)
        box[int(y0 * k):int(y1 * k), int(x0 * k):int(x1 * k)] = True
        return box

    rover = cm_box(100, 106, 125, 132)
    # Floor that differs between photos for a real reason: the rover, and R4,
    # which was on the seam at 14:27 and south of it at 15:52.
    moved = rover | cm_box(125, 105, 160, 150)
    base, base_seen = straightened('IMG_8559.jpg')

    def like_base(image, seen):
        both = base_seen & seen & ~moved
        a = cv2.cvtColor(image.astype(np.uint8), cv2.COLOR_BGR2LAB).astype(np.float32)
        b = cv2.cvtColor(base.astype(np.uint8), cv2.COLOR_BGR2LAB).astype(np.float32)
        for c in range(3):
            a[..., c] = ((a[..., c] - a[..., c][both].mean()) / (a[..., c][both].std() + 1e-6)
                         * b[..., c][both].std() + b[..., c][both].mean())
        return cv2.cvtColor(np.clip(a, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR).astype(np.float32)

    def blend(onto, image, weight):
        w = weight[..., None]
        return onto * (1 - w) + image * w

    out, have = base, base_seen.copy()
    for i, name in enumerate(['IMG_8518.jpg', 'IMG_8520.jpg', WIDE]):
        if name not in to_wide:
            continue
        image, seen = straightened(name)
        image = like_base(image, seen)
        if i == 0:
            soft = np.clip(cv2.GaussianBlur(rover.astype(np.float32), (0, 0), 1.5 * k) * 1.6, 0, 1)
            out = blend(out, image, soft * seen)
        need = ~have & seen
        soft = np.maximum(cv2.GaussianBlur(need.astype(np.float32), (0, 0), 5 * k), need)
        out = blend(out, image, soft * seen)
        have |= seen
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cv2.imwrite(path, np.clip(out, 0, 255).astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 75])


def main(folder, out, floor_path):
    os.makedirs(out, exist_ok=True)
    wide = load(folder, WIDE)
    wide_features = features(cv2.cvtColor(wide, cv2.COLOR_BGR2GRAY))

    # 1. Width: the tape, checked by the rover.
    rover_photo = load(folder, ROVER_PHOTO, grey=True)
    H, inliers, n = homography(features(rover_photo), wide_features)
    print(f'{ROVER_PHOTO} matched into {WIDE}: {inliers} of {n} matches agree')
    (l, t), (r, b) = ROVER_BOX
    rover = transform([(l, t), (r, t), (r, b), (l, b)], H)
    back_half = [BACK_LEFT, BACK_RIGHT, SEAM_RIGHT, SEAM_LEFT]
    rr = transform(rover, np.linalg.inv(unit_square_to(back_half)))
    width_frac = (rr[1, 0] + rr[2, 0] - rr[0, 0] - rr[3, 0]) / 2
    length_frac = (rr[2, 1] + rr[3, 1] - rr[0, 1] - rr[1, 1]) / 2
    width = TAPE_WIDTH_MM
    back_depth_by_rover = ROVER_LENGTH_MM / length_frac
    print(f'Width, west to east: {width} mm taped; the rover makes it {ROVER_WIDTH_MM / width_frac:.0f} mm')
    print(f'Back wall to seam, by the rover: {back_depth_by_rover:.0f} mm')

    # 2. Depth, from the lens.
    K = intrinsics(wide, ULTRA_WIDE_MM)
    aspect, angle = lens_shape(K, back_half)
    print(f'Back wall to seam, by the lens: {aspect * width:.0f} mm, corners at {angle:.1f} deg')
    aspect, angle = lens_shape(K, [BACK_LEFT, BACK_RIGHT, FRONT_RIGHT, FRONT_LEFT])
    depth = aspect * width
    print(f'Depth, north to south, by the lens: {depth:.0f} mm, corners at {angle:.1f} deg')
    floor = cv2.getPerspectiveTransform(np.float32([[0, 0], [width, 0], [width, depth], [0, depth]]),
                                        np.float32([BACK_LEFT, BACK_RIGHT, FRONT_RIGHT, FRONT_LEFT]))
    seam = transform([SEAM_LEFT, SEAM_RIGHT], np.linalg.inv(floor))[:, 1].mean()
    print(f'Seam at {seam:.0f} mm from the back wall')

    # 3. Top-down maps, every photo into the same coordinates.
    size = (int(width * OUT_PX_PER_MM), int(depth * OUT_PX_PER_MM))
    to_wide, greys = {WIDE: np.eye(3)}, {WIDE: cv2.cvtColor(wide, cv2.COLOR_BGR2GRAY)}
    for name in ['IMG_8518.jpg', 'IMG_8520.jpg', 'IMG_8559.jpg']:
        greys[name] = load(folder, name, grey=True)
        to_wide[name], inliers, n = homography(features(greys[name]), wide_features)
        print(f'{name} matched into {WIDE}: {inliers} of {n} matches agree')
    photo = top_down(load(folder, 'IMG_8559.jpg'), to_wide['IMG_8559.jpg'], floor, size)
    cv2.imwrite(os.path.join(out, 'yard-top-down.jpg'), photo, [cv2.IMWRITE_JPEG_QUALITY, 85])

    # 4. Where the ground rises, from the cleanest stereo pair. The rocks at
    # the back are certainly up, which fixes the sign.
    #
    # NOT HOW FAR IT RISES. Scaling this to centimetres by the rover (the only
    # thing of known height in both photos of a pair) gave the mounds anywhere
    # from 5 to 24 cm, and the edges either sign, depending only on the
    # feature detector's settings. Where the high ground is held to within
    # 3 cm across the same changes, so that is all this reports.
    clean = parallax(greys['IMG_8518.jpg'], greys['IMG_8520.jpg'], to_wide['IMG_8518.jpg'],
                     floor, width, depth, size)
    clean -= box_value(clean, 60, 60, 80, 80, 50)
    clean *= np.sign(np.mean([box_value(clean, x - 5, y - 5, x + 5, y + 5, 50) for _, x, y, _ in ROCKS[1:3]]))

    k = OUT_PX_PER_MM * 10
    search = np.where(np.isfinite(clean), clean, -np.inf)
    keep = np.zeros(search.shape, bool)
    keep[int(60 * k):int(170 * k), int(50 * k):int(125 * k)] = True
    search[~keep] = -np.inf
    peaks = []
    for _ in range(2):
        j, i = np.unravel_index(np.argmax(search), search.shape)
        peaks.append((i / k, j / k))
        search[max(0, j - 120):j + 120, max(0, i - 120):i + 120] = -np.inf

    print('Mound peaks (cm from west, from back):', [tuple(round(v) for v in p) for p in peaks])

    # 5. The simulator's floor (AB#464). IMG_8559 is the only photo with every
    # rock where it stays, so it is the base. The rover is lifted out of it
    # with IMG_8518, taken before the rover was put down, and the strip 8559
    # cut off is filled from the others. Each borrowed photo's colours are
    # matched to 8559 on floor both of them see, so the joins do not show.
    clean_floor(folder, to_wide, floor, width, depth, floor_path)
    print(f'Wrote the simulator floor to {floor_path}')

    # From 215 cm on, that pair is looking at the front wall's top, not the
    # floor behind it: not data.
    clean[int(215 * k):] = np.nan
    cv2.imwrite(os.path.join(out, 'yard-map.jpg'), figure(photo, clean, width / 10, depth / 10, peaks),
                [cv2.IMWRITE_JPEG_QUALITY, 85])
    print(f'Wrote yard-top-down.jpg and yard-map.jpg to {out}')


if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    if len(sys.argv) > 3:
        sys.exit(__doc__)
    out = sys.argv[2] if len(sys.argv) > 2 else here
    # The simulator serves its floor from mission-control's public folder. An
    # explicit output folder gets it instead, so a trial run changes nothing.
    floor_path = (os.path.join(out, 'floor.webp') if len(sys.argv) > 2 else
                  os.path.join(here, '..', '..', '..', 'mission-control', 'public', 'yards', 'curiosity', 'floor.webp'))
    main(os.path.expanduser(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(here, 'photos'), out,
         os.path.normpath(floor_path))
