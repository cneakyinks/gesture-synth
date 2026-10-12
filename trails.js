// ---- Fingertip neon trails ----
// Draws soft, delayed neon strokes that follow each fingertip, with a
// large feathered glow at each tip that fuses when fingers overlap.
// Colour follows the current chord (cyan when no chord is playing).
// Runs on its own canvas so it never touches the video or audio logic.

const FINGERTIP_INDICES = [4, 8, 12, 16, 20]; // thumb, index, middle, ring, pinky tips

export const TRAIL_STYLE = {
  lifeMs: 750,             // how long a point stays visible (higher = slower fade)
  follow: 0.16,            // 0-1: how fast the stroke catches up to the fingertip (lower = more delay)
  idleRGB: [0, 229, 255],  // colour when no chord is playing (neon cyan)
  coreWhiteMix: 0.7,       // inner core = chord colour blended this much toward white
  colorFadeMs: 250,        // how smoothly the colour changes between chords
  hazeWidth: 34,           // very wide, faint outer feather
  hazeAlpha: 0.07,
  glowWidth: 16,
  coreWidth: 2.5,
  glowAlpha: 0.2,
  coreAlpha: 0.85,
  tipRadius: 34,           // feathered glow at each fingertip (bigger = more fusing)
  tipAlpha: 0.32,          // per-tip strength; overlapping tips add up into one bright blob
  minStepPx: 1.5,          // skip near-duplicate points
  jumpResetFrac: 0.25,     // a jump bigger than this (x screen size) starts a new stroke
};

export function createTrailRenderer(canvas, style = TRAIL_STYLE) {
  const ctx = canvas.getContext("2d");
  // key "Left-8" -> { target: {x,y}|null, follower: {x,y}|null, points: [{x,y,t}] }
  const trails = new Map();
  let lastRenderTime = null;

  // Current and target colour, as [r, g, b]
  let color = [...style.idleRGB];
  let targetColor = [...style.idleRGB];
  let glowRGB = "";
  let coreRGB = "";

  // Pass [r, g, b] for a chord colour, or null to return to idle cyan.
  function setColor(rgb) {
    targetColor = rgb ? [...rgb] : [...style.idleRGB];
  }

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

    // Smoothly blend toward the chord colour
    const colorEase = 1 - Math.exp(-dt / style.colorFadeMs * 3);
    color = color.map((c, i) => c + (targetColor[i] - c) * colorEase);
    glowRGB = color.map(Math.round).join(", ");
    coreRGB = color.map((c) => Math.round(c + (255 - c) * style.coreWhiteMix)).join(", ");

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

      // 3. Draw: faint haze, glow, bright core, then the feathered tip
      if (trail.points.length >= 2) {
        drawStroke(trail.points, now, glowRGB, style.hazeWidth, style.hazeAlpha);
        drawStroke(trail.points, now, glowRGB, style.glowWidth, style.glowAlpha);
        drawStroke(trail.points, now, coreRGB, style.coreWidth, style.coreAlpha);
      }
      if (trail.points.length >= 1) {
        drawTip(trail.points[trail.points.length - 1], now);
      }
    }

    ctx.restore();
  }

  // Soft radial glow. Drawn additively, so nearby tips merge into one shape.
  function drawTip(head, now) {
    const life = Math.max(0, 1 - (now - head.t) / style.lifeMs);
    if (life <= 0) return;
    const r = style.tipRadius * (0.6 + 0.4 * life);
    const a = style.tipAlpha * life;
    const g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, r);
    g.addColorStop(0, `rgba(${coreRGB}, ${a})`);
    g.addColorStop(0.25, `rgba(${glowRGB}, ${a * 0.7})`);
    g.addColorStop(0.6, `rgba(${glowRGB}, ${a * 0.2})`);
    g.addColorStop(1, `rgba(${glowRGB}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(head.x, head.y, r, 0, Math.PI * 2);
    ctx.fill();
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

  return { updateTargets, render, setColor };
}
