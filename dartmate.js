'use strict';

/* ===== Constants ===== */
const TARGETS = [301, 501];
const MAX_PLAYERS = 4;
const DARTS_PER_TURN = 3;
const STORAGE_KEY = 'dartmate.settings';

// Clockwise order round a real board, starting at the top (20). Even indexes are
// the dark sectors (black single, red double/treble), odd indexes the light ones
// (cream single, green double/treble).
const BOARD_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

/* ===== State ===== */
const settings = {
  target: 301,
  numPlayers: 2,
  doubleIn: false,
  names: ['Player 1', 'Player 2', 'Player 3', 'Player 4']
};
let draft = null;  // copy of settings being edited on the options screen
let darts = [];    // every dart entered, e.g. 'T20', 'S5', 'D25' (bull), 'T0' (miss)
let cursor = 0;    // how many of those darts are applied (undo/redo moves this)
const ui = {};

/* ===== DOM helpers ===== */
function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}

// Reuse an element already in the HTML (emptied), or create it.
function getOrCreate(id, tag) {
  const e = document.getElementById(id) || el(tag, { id });
  e.replaceChildren();
  return e;
}

function button(text, className, onclick) {
  return el('button', { type: 'button', class: className, textContent: text, onclick });
}

/* ===== Darts ===== */
function parseDart(d) {
  const m = /^([SDT])(\d+)$/.exec(d);
  return m ? { mult: { S: 1, D: 2, T: 3 }[m[1]], num: +m[2] } : { mult: 0, num: 0 };
}

function getScore(d) {
  const { mult, num } = parseDart(d);
  return mult * num;
}

function isDouble(d) {
  return d[0] === 'D'; // includes D25, the bull
}

function getLabel(d) {
  if (d === 'D25') return 'BULL';
  if (d === 'T0') return 'MISS';
  if (d[0] === 'S') return d.slice(1);
  return d;
}

/* ===== Checkout suggestions ===== */
// Every dart that can be aimed at (misses excluded).
const SEGMENTS = [];
for (let n = 1; n <= 20; n++) SEGMENTS.push(`S${n}`, `D${n}`, `T${n}`);
SEGMENTS.push('S25', 'D25');

// Lower cost = preferred. Favour T20 to set up and finishing on D20, D18, D16, D8, D4.
const FINISH_COST = { D20: 0, D18: 1, D16: 2, D8: 3, D4: 4 };
function finishCost(d) {
  if (d in FINISH_COST) return FINISH_COST[d];
  return d === 'D25' ? 7 : 5;
}
function setupCost(d) {
  if (d === 'T20') return 0;
  if (d === 'S25') return 3;
  if (d[0] === 'D') return 5; // doubles are for finishing, not setting up
  return d[0] === 'S' ? 1 : 2; // singles are easier than other trebles
}

const checkoutCache = new Map();

// Best way to finish `score` with at most `dartsLeft` darts, ending on a double:
// fewest darts first, then lowest preference cost. Returns an array of darts or null.
function findCheckout(score, dartsLeft) {
  if (score < 2 || score > 170 || dartsLeft < 1) return null;
  const key = `${score}:${dartsLeft}`;
  if (checkoutCache.has(key)) return checkoutCache.get(key);

  const finishFor = rest => {
    if (rest === 50) return 'D25';
    return rest >= 2 && rest <= 40 && rest % 2 === 0 ? `D${rest / 2}` : null;
  };

  let best = null;
  for (let k = 1; k <= dartsLeft && !best; k++) {
    let bestCost = Infinity;
    const consider = setup => {
      const finish = finishFor(score - setup.reduce((s, d) => s + getScore(d), 0));
      if (!finish) return;
      const cost = setup.reduce((c, d) => c + setupCost(d), 0) + finishCost(finish);
      if (cost < bestCost) { bestCost = cost; best = [...setup, finish]; }
    };
    if (k === 1) consider([]);
    for (let i = 0; i < SEGMENTS.length && k > 1; i++) {
      if (k === 2) consider([SEGMENTS[i]]);
      else for (let j = i; j < SEGMENTS.length; j++) consider([SEGMENTS[i], SEGMENTS[j]]);
    }
  }

  if (best) {
    // Show T20s first, then the remaining set-up darts highest value first.
    const finish = best.pop();
    best.sort((a, b) => (b === 'T20') - (a === 'T20') || getScore(b) - getScore(a));
    best.push(finish);
  }
  checkoutCache.set(key, best);
  return best;
}

/* ===== Game logic =====
 * The game state is never stored: it is rebuilt by replaying the first `cursor`
 * darts, which makes undo/redo trivial.
 */
function replay() {
  const players = [];
  for (let i = 0; i < settings.numPlayers; i++) {
    players.push({ name: settings.names[i], score: settings.target, opened: !settings.doubleIn, turns: [] });
  }

  let current = 0;
  let turn = null;      // turn in progress
  let lastTurn = null;  // most recently completed turn
  let winner = null;

  for (let i = 0; i < cursor; i++) {
    const p = players[current];
    const d = darts[i];

    if (!turn) {
      turn = { player: current, darts: [], startScore: p.score, startOpened: p.opened, bust: false, total: 0, done: false };
      p.turns.push(turn);
    }
    turn.darts.push(d);

    let value = getScore(d);
    if (!p.opened) {
      // Double in: nothing counts until a double (or bull) is hit.
      if (isDouble(d)) p.opened = true;
      else value = 0;
    }

    const left = p.score - value;
    if (left < 0 || left === 1 || (left === 0 && !isDouble(d))) {
      // Bust: the whole turn is void.
      turn.bust = true;
      p.score = turn.startScore;
      p.opened = turn.startOpened;
    } else {
      p.score = left;
    }
    turn.total = turn.bust ? 0 : turn.startScore - p.score;
    if (p.score === 0) winner = current;

    if (turn.bust || winner !== null || turn.darts.length === DARTS_PER_TURN) {
      turn.done = true;
      lastTurn = turn;
      turn = null;
      if (winner !== null) break;
      current = (current + 1) % players.length;
    }
  }

  return { players, current, turn, lastTurn, winner };
}

function throwDart(d) {
  if (replay().winner !== null) return;
  darts.length = cursor; // entering a dart discards any redo history
  darts.push(d);
  cursor++;

  stopCelebration();

  const g = render();
  const won = g.winner !== null;
  const finished = !g.turn ? g.lastTurn : null; // the turn this dart completed, if any
  const kind = finished ? pickCelebration(finished, won) : null;

  if (kind) celebrate(kind, finished, g.players[finished.player], won ? () => showWinner(g) : null);
  else if (won) showWinner(g);
  else if (finished) showPopup(finished.bust ? 'BUST' : finished.total, finished.bust);
  else hidePopup();
}

function undo() {
  if (cursor === 0) return;
  cursor--;
  ui.winner.hidden = true;
  hidePopup();
  stopCelebration();
  render();
}

function redo() {
  if (cursor >= darts.length) return;
  cursor++;
  hidePopup();
  stopCelebration();
  const g = render();
  if (g.winner !== null) showWinner(g);
}

function newGame() {
  darts = [];
  cursor = 0;
  ui.winner.hidden = true;
  hidePopup();
  stopCelebration();
  render();
}

/* ===== Rendering ===== */
function render() {
  const g = replay();
  ui.scores.style.setProperty('--cols', g.players.length);
  ui.scores.classList.toggle('compact', g.players.length >= 3);
  ui.scores.replaceChildren(...g.players.map((p, i) => playerCard(p, i, g)));
  ui.undoBtn.disabled = cursor === 0;
  ui.redoBtn.disabled = cursor >= darts.length;
  return g;
}

function playerCard(p, i, g) {
  const active = g.winner === null && i === g.current;
  // The active player sees only their turn in progress (blank until the first dart);
  // everyone else keeps showing their last completed turn.
  const shown = active ? g.turn : p.turns[p.turns.length - 1];

  let turnText = ' ';
  if (shown) {
    turnText = shown.darts.map(getLabel).join(' ');
    if (shown.done) turnText += shown.bust ? ' · BUST' : ` = ${shown.total}`;
  }

  // Bottom row: darts left this turn (active player) and a "needs a double to start" badge.
  const thrown = active && g.turn ? g.turn.darts.length : 0;
  const pips = el('div', { class: 'pips' + (active ? '' : ' invisible') });
  for (let d = 0; d < DARTS_PER_TURN; d++) pips.append(el('span', { class: d < DARTS_PER_TURN - thrown ? 'left' : '' }));
  const checkout = active && p.opened ? findCheckout(p.score, DARTS_PER_TURN - thrown) : null;
  const meta = el('div', { class: 'player-meta' }, pips,
    p.opened ? null : el('span', { class: 'badge', textContent: 'dbl in', title: 'Needs a double to start scoring' }),
    checkout ? el('span', { class: 'checkout' },
      el('span', { class: 'checkout-label', textContent: 'To win: ' }),
      checkout.map(getLabel).join(' ')) : null);

  return el('div', { class: 'player' + (active ? ' active' : '') + (g.winner === i ? ' won' : '') },
    el('div', { class: 'player-name', textContent: p.name }),
    el('div', { class: 'player-score', textContent: p.score }),
    el('div', { class: 'player-turn', textContent: turnText }),
    meta
  );
}

function showPopup(text, bust) {
  const p = ui.popup;
  p.textContent = text;
  p.classList.remove('show');
  void p.offsetWidth; // restart the animation
  p.classList.toggle('bust', !!bust);
  p.classList.add('show');
}

function hidePopup() {
  ui.popup.classList.remove('show');
}

function showWinner(g) {
  const p = g.players[g.winner];
  const n = p.turns.reduce((sum, t) => sum + t.darts.length, 0);
  ui.winnerText.textContent = `${p.name} wins!`;
  ui.winnerSub.textContent = `Checked out in ${n} darts`;
  hidePopup();
  ui.winner.hidden = false;
}

/* ===== Celebrations =====
 * In order of magnitude: win with 170, Shanghai finish (T20 20 D20), win with 100+, 180,
 * any other win (simple confetti), 100+.
 * Each has its own effect; they sit above everything but never block taps, and
 * the next dart (or undo, options, new game) cancels one still playing.
 */
const CELEBRATIONS = {
  bigFish: { duration: 5500, vibrate: [80, 60, 80, 60, 300], run: celebrateBigFish },
  shanghai: { duration: 5000, vibrate: [60, 40, 60, 40, 60, 40, 250], run: celebrateShanghai },
  tonOut:  { duration: 4500, vibrate: [60, 50, 200], run: celebrateTonOut },
  max:     { duration: 3800, vibrate: [100, 60, 100, 60, 100], run: celebrate180 },
  win:     { duration: 3200, vibrate: [60, 40, 120], run: celebrateWin },
  ton:     { duration: 2400, vibrate: [60], run: celebrateTon }
};

function pickCelebration(turn, won) {
  if (turn.bust) return null;
  if (won) {
    if (turn.total === 170) return 'bigFish';
    if (isShanghai(turn)) return 'shanghai';
    return turn.total >= 100 ? 'tonOut' : 'win';
  }
  if (turn.total === 180) return 'max';
  if (turn.total >= 100) return 'ton';
  return null;
}

// Shanghai finish: single, treble and double 20 in one visit, ending on the D20 (120).
function isShanghai(turn) {
  const [a, b, c] = turn.darts;
  return turn.darts.length === 3 && c === 'D20' &&
    ((a === 'T20' && b === 'S20') || (a === 'S20' && b === 'T20'));
}

function reducedMotion() {
  return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let celTimer = null;
let celDone = null; // runs when a celebration plays to the end (e.g. show the winner screen)

function buildCelebration() {
  ui.cel = getOrCreate('celebration', 'div');
  ui.cel.setAttribute('aria-live', 'polite');
  ui.celCanvas = el('canvas', { class: 'cel-canvas' });
  ui.celStage = el('div', { class: 'cel-stage' });
  ui.cel.append(ui.celCanvas, ui.celStage);
}

function celebrate(kind, turn, player, onDone) {
  stopCelebration();
  void ui.cel.offsetWidth; // flush styles so the fade animations restart from the beginning
  hidePopup();
  const c = CELEBRATIONS[kind];
  celDone = onDone;
  ui.cel.style.setProperty('--dur', `${c.duration}ms`);
  ui.cel.className = `show cel-${kind}`;
  c.run(turn, player, c.duration);
  try { if (navigator.vibrate) navigator.vibrate(c.vibrate); } catch (e) { /* not supported */ }
  celTimer = setTimeout(() => {
    const done = celDone;
    stopCelebration();
    if (done) done();
  }, c.duration);
}

function stopCelebration() {
  if (!ui.cel) return;
  clearTimeout(celTimer);
  celTimer = null;
  celDone = null;
  fxStop();
  ui.cel.className = '';
  ui.celStage.replaceChildren();
  document.body.classList.remove('shake');
}

function text(cls, content, style) {
  const e = el('div', { class: cls, textContent: content });
  if (style) e.style.cssText = style;
  return e;
}

// 1. Win with 170: fireworks, shimmering gold title, heartbeat 170, screen shake.
function celebrateBigFish(turn, player, duration) {
  ui.celStage.append(
    text('cel-title', 'The Big Fish!'),
    text('cel-number', '170'),
    text('cel-sub', `${player.name} checks out ${turn.darts.map(getLabel).join(' ')}`));
  if (!reducedMotion()) {
    document.body.classList.add('shake');
    fxStart(fireworksEmitter(), duration);
  }
}

// 2. Shanghai finish: the three darts fly in from different edges and lock into a row
//    while dartboard rings ripple out behind them.
function celebrateShanghai(turn, player) {
  const rings = el('div', { class: 'cel-rings' });
  for (let i = 0; i < 4; i++) {
    rings.append(el('span', { class: i % 2 ? 'green' : 'red', style: `animation-delay: ${0.6 + i * 0.4}s` }));
  }
  const origins = [['-110vw', '-40vh', '-40deg'], ['110vw', '-40vh', '40deg'], ['0', '90vh', '0deg']];
  const flights = el('div', { class: 'cel-flights' });
  turn.darts.forEach((d, i) => {
    const [fx, fy, fr] = origins[i];
    flights.append(el('span', {
      class: `cel-flight ${dartColor(d)}`,
      textContent: getLabel(d),
      style: `--fx: ${fx}; --fy: ${fy}; --fr: ${fr}; animation-delay: ${i * 0.22}s`
    }));
  });
  ui.celStage.append(
    rings,
    flights,
    text('cel-title', 'Shanghai!'),
    text('cel-number', '120'),
    text('cel-sub', `${player.name} checks out ${turn.darts.map(getLabel).join(' ')}`));
}

// 3. Win with 100+: confetti in board colours, bouncing score.
function celebrateTonOut(turn, player, duration) {
  ui.celStage.append(
    text('cel-title', 'Ton-plus finish!'),
    text('cel-number', turn.total),
    text('cel-sub', `${player.name} checks out ${turn.darts.map(getLabel).join(' ')}`));
  if (!reducedMotion()) fxStart(confettiEmitter(), duration);
}

// 4. 180: spinning sunburst, strobe flash, neon 180 zooming in.
function celebrate180(turn, player) {
  ui.celStage.append(
    el('div', { class: 'cel-rays' }),
    el('div', { class: 'cel-flash' }),
    text('cel-number', '180'),
    text('cel-title', 'One hundred and eighty!'),
    text('cel-sub', player.name));
}

// 5. 100+: score swooshes in with a light sweep across it.
function celebrateTon(turn, player) {
  ui.celStage.append(
    text('cel-number', turn.total),
    text('cel-title', turn.total >= 140 ? 'Ton-forty!' : 'Ton!'),
    text('cel-sub', player.name));
}

// Any other win: a light shower of confetti and a simple "Game shot!".
function celebrateWin(turn, player, duration) {
  ui.celStage.append(
    text('cel-title', 'Game shot!'),
    text('cel-sub', `${player.name} checks out ${turn.darts.map(getLabel).join(' ')}`));
  if (!reducedMotion()) fxStart(confettiEmitter(45), duration);
}

/* ----- Canvas particle effects (fireworks, confetti) ----- */
const FX_COLORS = ['#e8382f', '#2fa35a', '#f6e7c8', '#f5c542', '#ffffff'];
let fxParts = [];
let fxRaf = 0;

function fxStart(emit, duration) {
  const cv = ui.celCanvas;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth, h = window.innerHeight;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  fxParts = [];
  const stopEmitting = performance.now() + duration - 1200; // let the last particles fade out
  let last = performance.now();

  const frame = now => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (now < stopEmitting) emit(dt, w, h);

    ctx.clearRect(0, 0, w, h);
    const parts = fxParts;
    fxParts = []; // anything spawned this frame (e.g. an explosion) lands here
    const alive = [];
    for (const p of parts) {
      p.life -= dt;
      if (p.life <= 0) { if (p.onDeath) p.onDeath(p); continue; }
      const drag = Math.pow(p.drag, dt * 60);
      p.vx *= drag;
      p.vy = p.vy * drag + p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.update) p.update(p, dt);
      p.draw(ctx, p);
      alive.push(p);
    }
    fxParts = alive.concat(fxParts);
    fxRaf = fxParts.length || now < stopEmitting ? requestAnimationFrame(frame) : 0;
  };
  fxRaf = requestAnimationFrame(frame);
}

function fxStop() {
  cancelAnimationFrame(fxRaf);
  fxRaf = 0;
  fxParts = [];
  const cv = ui.celCanvas;
  if (cv) cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
}

const rand = (a, b) => a + Math.random() * (b - a);
const pick = list => list[Math.floor(Math.random() * list.length)];

function drawSpark(ctx, p) {
  ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function explode(x, y) {
  const color = pick(FX_COLORS);
  const n = 70;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(-0.05, 0.05);
    const speed = rand(90, 240);
    const life = rand(1.0, 1.6);
    fxParts.push({
      x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, g: 110, drag: 0.965,
      life, maxLife: life, size: rand(1.5, 2.8), color: Math.random() < 0.2 ? '#fff' : color, draw: drawSpark
    });
  }
}

function fireworksEmitter() {
  let wait = 0;
  return (dt, w, h) => {
    wait -= dt;
    if (wait > 0) return;
    wait = rand(0.25, 0.55);
    const g = 380;
    const targetY = rand(h * 0.12, h * 0.45);
    const vy = -Math.sqrt(2 * g * (h - targetY)); // just reaches targetY
    const life = -vy / g;
    fxParts.push({
      x: rand(w * 0.15, w * 0.85), y: h, vx: rand(-30, 30), vy, g, drag: 1,
      life, maxLife: life, size: 2.5, color: '#fff6c8',
      draw: (ctx, p) => { ctx.fillStyle = p.color; ctx.fillRect(p.x - 1.5, p.y, 3, 10); },
      onDeath: p => explode(p.x, p.y)
    });
  };
}

function confettiEmitter(perSecond = 140) {
  let carry = 0;
  return (dt, w) => {
    carry += dt * perSecond;
    for (; carry >= 1; carry--) {
      const life = rand(3, 4.5);
      fxParts.push({
        x: rand(0, w), y: rand(-40, -10), vx: rand(-40, 40), vy: rand(60, 160), g: 30, drag: 0.99,
        life, maxLife: life, color: pick(FX_COLORS), w: rand(6, 11), h: rand(3, 6),
        rot: rand(0, Math.PI), spin: rand(-8, 8), phase: rand(0, 6),
        update: (p, step) => { p.rot += p.spin * step; p.phase += step * 3; p.x += Math.sin(p.phase) * 0.8; },
        draw: (ctx, p) => {
                  ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.scale(1, Math.cos(p.phase)); // flutter
          ctx.globalAlpha = Math.min(1, p.life);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
      });
    }
  };
}

/* ===== Building the UI ===== */
function dartButton(d, color) {
  return el('button', {
    type: 'button',
    class: `dart ${color}`,
    title: d,
    textContent: getLabel(d),
    onclick: () => throwDart(d)
  });
}

// Board colour of a dart, as used on a real dartboard.
function dartColor(d) {
  if (d === 'D25') return 'red';
  if (d === 'S25') return 'green';
  if (d === 'T0') return 'miss';
  const dark = BOARD_ORDER.indexOf(parseDart(d).num) % 2 === 0;
  if (d[0] === 'S') return dark ? 'black' : 'cream';
  return dark ? 'red' : 'green';
}

function numberRow(n) {
  return el('div', { class: 'row' },
    ...['D', 'S', 'T'].map(m => dartButton(`${m}${n}`, dartColor(`${m}${n}`))));
}

function buildBoard() {
  const left = el('div', { class: 'col' });
  const right = el('div', { class: 'col' });

  left.append(el('div', { class: 'row' },
    dartButton('D25', 'red'),
    dartButton('S25', 'green'),
    dartButton('T0', 'miss')));
  for (let n = 20; n >= 11; n--) left.append(numberRow(n));
  for (let n = 10; n >= 1; n--) right.append(numberRow(n));

  ui.undoBtn = button('‹ Undo', 'nav', undo);
  ui.redoBtn = button('Redo ›', 'nav', redo);
  const optionsBtn = getOrCreate('optionsBtn', 'button');
  optionsBtn.type = 'button';
  optionsBtn.className = 'nav';
  optionsBtn.textContent = 'Options';
  optionsBtn.addEventListener('click', openOptions);
  right.append(el('div', { class: 'row' }, ui.undoBtn, optionsBtn, ui.redoBtn));

  ui.board.append(left, right);
}

function buildWinner() {
  ui.winner = getOrCreate('winner', 'section');
  ui.winner.className = 'overlay';
  ui.winner.hidden = true;
  ui.winnerText = el('h1');
  ui.winnerSub = el('p', { class: 'sub' });
  ui.winner.append(el('div', { class: 'overlay-box' },
    ui.winnerText,
    ui.winnerSub,
    el('div', { class: 'overlay-actions' },
      button('Undo', 'action', undo),
      button('Options', 'action', openOptions),
      button('New game', 'action primary', newGame))));
}

function segmented(values, onPick) {
  const wrap = el('div', { class: 'segmented' });
  for (const v of values) {
    wrap.append(el('button', { type: 'button', textContent: String(v), dataset: { value: v }, onclick: () => onPick(v) }));
  }
  return wrap;
}

function field(label, control) {
  return el('div', { class: 'field' }, el('span', { class: 'field-label', textContent: label }), control);
}

function buildOptions() {
  ui.options = getOrCreate('options', 'section');
  ui.options.className = 'overlay';
  ui.options.hidden = true;

  ui.optTarget = segmented(TARGETS, v => { draft.target = v; syncOptions(); });
  ui.optPlayers = segmented([1, 2, 3, 4].slice(0, MAX_PLAYERS), v => { draft.numPlayers = v; syncOptions(); });
  ui.optDoubleIn = el('input', { type: 'checkbox', onchange: e => { draft.doubleIn = e.target.checked; } });
  ui.optNames = el('div', { class: 'names' });

  ui.options.append(el('div', { class: 'overlay-box' },
    el('h1', { textContent: 'Options' }),
    field('Target', ui.optTarget),
    field('Players', ui.optPlayers),
    el('label', { class: 'field toggle' },
      el('span', { class: 'field-label', textContent: 'Double in' }),
      ui.optDoubleIn,
      el('span', { class: 'switch' })),
    field('Names', ui.optNames),
    el('p', { class: 'sub', textContent: 'Starting a new game clears the current scores.' }),
    el('div', { class: 'overlay-actions' },
      button('Back', 'action', closeOptions),
      button('New game', 'action primary', applyOptions))));
}

function syncOptions() {
  for (const [wrap, val] of [[ui.optTarget, draft.target], [ui.optPlayers, draft.numPlayers]]) {
    for (const b of wrap.children) {
      const on = +b.dataset.value === val;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-pressed', on);
    }
  }
  ui.optDoubleIn.checked = draft.doubleIn;
  ui.optNames.replaceChildren(...draft.names.slice(0, draft.numPlayers).map((name, i) =>
    el('input', {
      type: 'text',
      value: name,
      maxLength: 16,
      placeholder: `Player ${i + 1}`,
      oninput: e => { draft.names[i] = e.target.value; }
    })));
}

function openOptions() {
  draft = { ...settings, names: [...settings.names] };
  syncOptions();
  hidePopup();
  stopCelebration();
  ui.options.hidden = false;
}

function closeOptions() {
  ui.options.hidden = true;
  const g = replay();
  if (g.winner !== null) showWinner(g); // e.g. options opened mid win-celebration
}

function applyOptions() {
  Object.assign(settings, draft, {
    names: draft.names.map((n, i) => n.trim() || `Player ${i + 1}`)
  });
  saveSettings();
  closeOptions();
  newGame();
}

/* ===== Settings persistence (per device, optional) ===== */
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!s) return;
    if (TARGETS.includes(s.target)) settings.target = s.target;
    if (Number.isInteger(s.numPlayers) && s.numPlayers >= 1 && s.numPlayers <= MAX_PLAYERS) settings.numPlayers = s.numPlayers;
    settings.doubleIn = !!s.doubleIn;
    if (Array.isArray(s.names)) {
      s.names.slice(0, MAX_PLAYERS).forEach((n, i) => {
        if (typeof n === 'string' && n.trim()) settings.names[i] = n.trim().slice(0, 16);
      });
    }
  } catch (e) { /* storage unavailable: use defaults */ }
}

function saveSettings() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
}

/* ===== Start up ===== */
// Without width=device-width a phone lays the page out ~980px wide and, because
// zooming out is blocked, only shows a corner of the board. Fix the viewport here
// so the page sizes itself to the phone's screen whatever the HTML says.
function setViewport() {
  let meta = document.querySelector('meta[name="viewport"]');
  if (!meta) {
    meta = el('meta', { name: 'viewport' });
    document.head.append(meta);
  }
  meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
}

function init() {
  loadSettings();

  ui.scores = getOrCreate('scores', 'header');
  ui.board = getOrCreate('board', 'main');
  ui.popup = getOrCreate('throwScore', 'div');
  ui.popup.addEventListener('animationend', hidePopup);

  buildBoard();
  buildWinner();
  buildOptions();
  buildCelebration();
  document.body.append(ui.scores, ui.board, ui.popup, ui.winner, ui.options, ui.cel);

  window.addEventListener('beforeunload', e => {
    if (cursor > 0 && replay().winner === null) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  render();
}

setViewport(); // straight away, before the first layout if possible
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
