// ---- Fingertip neon trails ----
// Draws soft, slightly delayed cyan strokes that follow each fingertip and
// fade out quickly. Runs on its own canvas so it never touches the video
// layer or the chord/audio logic.

const FINGERTIP_INDICES = [4, 8, 12, 16, 20]; // thumb, index, middle, ring, pinky tips

export const TRAIL_STYLE = {
  lifeMs: 280,             // how long a point stays visible (short = next stroke stays clean)
  follow: 0.35,            // 0-1: how fast the stroke catches up to the fingertip (lower = more delay)
  glowRGB: "0, 229, 255",  // outer neon glow
  coreRGB: "190, 252, 255",// bright inner core
  glowWidth: 14,
  coreWidth: 2.5,
  glowAlpha: 0.22,
  coreAlpha: 0.95,
  minStepPx: 1.5,          // skip near-duplicate points
  jumpResetFrac: 0.25,     // a jump bigger than this (x screen size) starts a new stroke
};

export function createTrailRenderer(canvas, style = TRAIL_STYLE) {
  const ctx = canvas.getContext("2d");
  // key "Left-8" -> { target: {x,y}|null, follower: {x,y}|null, points: [{x,y,t}] }
  const trails = new Map();
  let lastRenderTime = null;

  function getTrail(key) {
    let trail = trails.get(key);
    if (!trail) {
      trail = { target: null, follower: null, points: [] };
      trails.set(key, trail);
    }
    return trail;
  }

  // Called whenever MediaPipe returns a new result.
  // hands: [{ handedness: "Left"|"Right", landmarks: [...] }]
  // toCanvas: (landmark) => {x, y} in on-screen canvas pixels
  function updateTargets(hands, toCanvas) {
    for (const trail of trails.values()) trail.target = null;

    for (const { handedness, landmarks } of hands) {
      for (const tipIndex of FINGERTIP_INDICES) {
        const point = landmarks[tipIndex];
        if (!point) continue;
        getTrail(`${handedness}-${tipIndex}`).target = toCanvas(point);
      }
    }
  }

  // Called every animation frame.
  function render(now) {
    const dt = lastRenderTime === null ? 16.7 : Math.min(100, now - lastRenderTime);
    lastRenderTime = now;

    const width = canvas.width;
    const height = canvas.height;
    const jumpLimit = style.jumpResetFrac * Math.min(width, height);
    // Frame-rate independent easing (same feel at 60 Hz and 120 Hz)
    const ease = 1 - Math.pow(1 - style.follow, dt / 16.7);

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const trail of trails.values()) {
      // 1. Advance the delayed follower toward the fingertip
      if (trail.target) {
        const f = trail.follower;
        const jumped = f && Math.hypot(trail.target.x - f.x, trail.target.y - f.y) > jumpLimit;

        if (!f || jumped) {
          // Hand just appeared or tracking teleported: start a fresh stroke
          trail.follower = { ...trail.target };
          trail.points = [];
        } else {
          f.x += (trail.target.x - f.x) * ease;
          f.y += (trail.target.y - f.y) * ease;
        }

        const last = trail.points[trail.points.length - 1];
        if (!last || Math.hypot(trail.follower.x - last.x, trail.follower.y - last.y) >= style.minStepPx) {
          trail.points.push({ x: trail.follower.x, y: trail.follower.y, t: now });
        } else {
          last.t = now; // finger is still: keep the head alive without stacking points
        }
      } else {
        // Hand gone: stop adding, let the existing stroke fade out
        trail.follower = null;
      }

      // 2. Expire old points
      while (trail.points.length && now - trail.points[0].t > style.lifeMs) {
        trail.points.shift();
      }

      // 3. Draw: wide faint glow pass, then thin bright core pass
      if (trail.points.length >= 2) {
        drawStroke(trail.points, now, style.glowRGB, style.glowWidth, style.glowAlpha);
        drawStroke(trail.points, now, style.coreRGB, style.coreWidth, style.coreAlpha);
      }
    }

    ctx.restore();
  }

  // Smooth curve through midpoints; width and opacity taper with age.
  function drawStroke(points, now, rgb, baseWidth, baseAlpha) {
    const n = points.length;
    for (let i = 1; i < n; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const next = points[i + 1];

      const life = Math.max(0, 1 - (now - curr.t) / style.lifeMs);
      if (life <= 0) continue;

      const startX = i === 1 ? prev.x : (prev.x + curr.x) / 2;
      const startY = i === 1 ? prev.y : (prev.y + curr.y) / 2;
      const endX = next ? (curr.x + next.x) / 2 : curr.x;
      const endY = next ? (curr.y + next.y) / 2 : curr.y;

      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.quadraticCurveTo(curr.x, curr.y, endX, endY);
      ctx.strokeStyle = `rgba(${rgb}, ${baseAlpha * life * life})`;
      ctx.lineWidth = Math.max(0.5, baseWidth * life);
      ctx.stroke();
    }
  }

  return { updateTargets, render };
}
