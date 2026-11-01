const { Keypair, VersionedTransaction, Transaction, SystemProgram, PublicKey } = solanaWeb3;
const $ = s => document.querySelector(s);
const LS = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del: k => { try { localStorage.removeItem(k); } catch {} }
};
const b64 = u8 => btoa(String.fromCharCode(...u8));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- radar ---------- */
const cv = $('#radar'), ctx = cv.getContext('2d');
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
let W, H, sweep = 0, blips = [], live = false, lastAmbient = 0;
function resize() { W = cv.width = innerWidth * devicePixelRatio; H = cv.height = innerHeight * devicePixelRatio; }
addEventListener('resize', resize); resize();
function addBlip(strong) { blips.push({ r: .1 + Math.random() * .85, a: Math.random() * Math.PI * 2, born: performance.now(), strong }); }
function draw(t) {
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H * .46, R = Math.min(W, H) * .44;
  ctx.lineWidth = devicePixelRatio;
  for (let i = 1; i <= 4; i++) { ctx.strokeStyle = `rgba(159,232,255,${.1 + i * .02})`; ctx.beginPath(); ctx.arc(cx, cy, R * i / 4, 0, 7); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(159,232,255,.22)';
  ctx.beginPath(); ctx.moveTo(cx - R * 1.15, cy); ctx.lineTo(cx + R * 1.15, cy); ctx.moveTo(cx, cy - R * 1.15); ctx.lineTo(cx, cy + R * 1.15); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,61,129,.7)'; ctx.lineWidth = 2 * devicePixelRatio;
  const k = R * .07; [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => { ctx.beginPath(); ctx.moveTo(cx + sx * R * 1.02, cy + sy * (R * 1.02 - k)); ctx.lineTo(cx + sx * R * 1.02, cy + sy * R * 1.02); ctx.lineTo(cx + sx * (R * 1.02 - k), cy + sy * R * 1.02); ctx.stroke(); });
  if (!still) sweep += .018;
  if (ctx.createConicGradient) {
    const g = ctx.createConicGradient(sweep - 1.2, cx, cy);
    g.addColorStop(0, 'rgba(124,92,255,0)'); g.addColorStop(.19, 'rgba(124,92,255,.35)'); g.addColorStop(.2, 'rgba(159,232,255,.0)'); g.addColorStop(1, 'rgba(124,92,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(159,232,255,.8)'; ctx.lineWidth = 1.5 * devicePixelRatio;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sweep) * R, cy + Math.sin(sweep) * R); ctx.stroke();
  if (!live && !still && t - lastAmbient > 1400) { addBlip(false); lastAmbient = t; }
  blips = blips.filter(b => t - b.born < 4200);
  for (const b of blips) {
    const age = (t - b.born) / 4200, x = cx + Math.cos(b.a) * b.r * R, y = cy + Math.sin(b.a) * b.r * R;
    const col = b.strong ? '255,61,129' : '159,232,255';
    ctx.fillStyle = `rgba(${col},${1 - age})`; ctx.beginPath(); ctx.arc(x, y, (b.strong ? 4 : 3) * devicePixelRatio, 0, 7); ctx.fill();
    ctx.strokeStyle = `rgba(${col},${.8 * (1 - age)})`; ctx.lineWidth = devicePixelRatio;
    ctx.beginPath(); ctx.arc(x, y, (6 + age * 34) * devicePixelRatio, 0, 7); ctx.stroke();
  }
  if (!still) requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

/* ---------- unlock / payment ---------- */
const provider = () => window.phantom?.solana ?? window.solana;
const gateMsg = (t, ok) => { const m = $('#gateMsg'); m.textContent = t; m.className = 'msg' + (ok ? ' ok' : ''); };
async function connect() {
  const p = provider();
  if (!p?.isPhantom) throw new Error('Phantom wallet not found. Install Phantom, then try again.');
  return (await p.connect()).publicKey.toString();
}
async function redeem(payer, signature) {
  gateMsg('Sign the message in your wallet to prove you paid.', true);
  const { signature: proof } = await provider().signMessage(new TextEncoder().encode(`crypto-sniper:${signature}`), 'utf8');
  gateMsg('Verifying payment on-chain.', true);
  const r = await fetch('/api/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payer, signature, proof: b64(proof) }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  LS.set('cs_token', j.token); LS.set('cs_sig', signature);
  enterApp();
}
async function unlock() {
  const btn = $('#unlock'); btn.disabled = true;
  try {
    const cfg = await (await fetch('/api/config')).json();
    const payer = await connect();
    const { blockhash } = await (await fetch('/api/blockhash')).json();
    const from = new PublicKey(payer);
    const tx = new Transaction({ feePayer: from, recentBlockhash: blockhash })
      .add(SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(cfg.payWallet), lamports: Math.round(cfg.priceSol * 1e9) }));
    gateMsg(`Approve the ${cfg.priceSol} SOL payment in your wallet.`, true);
    const { signature } = await provider().signAndSendTransaction(tx);
    await redeem(payer, signature);
  } catch (e) { gateMsg(e.message || 'Payment cancelled.'); } finally { btn.disabled = false; }
}
$('#unlock').onclick = unlock;
$('#toggleRestore').onclick = () => { const r = $('#restore'); r.hidden = !r.hidden; };
$('#restoreGo').onclick = async () => {
  try { const sig = $('#restoreSig').value.trim(); if (!sig) throw new Error('Paste the signature of your 1 SOL payment.'); await redeem(await connect(), sig); }
  catch (e) { gateMsg(e.message); }
};

/* ---------- settings ---------- */
const SCHEMA = [
  ['buySol', 'Buy size (SOL)', 0.05, 'number', 0.001], ['slippage', 'Slippage %', 25, 'number', 1],
  ['priorityFee', 'Priority fee (SOL)', 0.002, 'number', 0.0005], ['minDevBuy', 'Min dev buy (SOL)', 0.5, 'number', 0.1],
  ['maxDevBuy', 'Max dev buy (SOL)', 4, 'number', 0.1], ['maxPositions', 'Max open positions', 3, 'number', 1],
  ['sessionCap', 'Session spend cap (SOL)', 0.5, 'number', 0.05], ['holdSec', 'Auto-sell after (sec, 0 = off)', 0, 'number', 5],
  ['blocklist', 'Blocklist (comma separated)', 'test,rug,scam,airdrop', 'text'], ['dryRun', 'Dry run', true, 'select']
];
const S = Object.assign(Object.fromEntries(SCHEMA.map(f => [f[0], f[2]])), LS.get('cs_settings', {}));
function renderForm() {
  $('#form').innerHTML = SCHEMA.map(([k, label, , type, step]) => {
    const wide = type === 'text' ? ' wide' : '';
    const ctl = type === 'select' ? `<select data-k="${k}"><option value="true"${S[k] ? ' selected' : ''}>On</option><option value="false"${S[k] ? '' : ' selected'}>Off</option></select>`
      : `<input data-k="${k}" type="${type}" ${step ? `step="${step}" min="0"` : ''} value="${esc(S[k])}">`;
    return `<div class="field${wide}"><label>${label}</label>${ctl}</div>`;
  }).join('');
  $('#form').oninput = e => {
    const k = e.target.dataset.k; if (!k) return;
    const t = SCHEMA.find(f => f[0] === k)[3], v = e.target.value;
    S[k] = t === 'number' ? Number(v) : t === 'select' ? v === 'true' : v;
    LS.set('cs_settings', S); paintArm();
  };
}

/* ---------- burner wallet ---------- */
let burner = null;
const saved = LS.get('cs_burner');
if (saved) try { burner = Keypair.fromSecretKey(Uint8Array.from(saved)); } catch {}
const authH = () => ({ 'content-type': 'application/json', authorization: `Bearer ${LS.get('cs_token')}` });
async function renderWallet() {
  if (!burner) {
    $('#wallet').innerHTML = `<p class="note">Generate a fresh burner wallet and fund it with only what you can lose.</p><div class="row"><button class="btn sm" id="gen">Generate burner</button><button class="btn sm ghost" id="imp">Import key</button></div>`;
    $('#gen').onclick = () => { burner = Keypair.generate(); LS.set('cs_burner', [...burner.secretKey]); renderWallet(); };
    $('#imp').onclick = () => { try { const a = JSON.parse(prompt('Paste the secret key as a JSON array of 64 numbers')); burner = Keypair.fromSecretKey(Uint8Array.from(a)); LS.set('cs_burner', [...burner.secretKey]); renderWallet(); } catch { log('Import failed. Expected a JSON array of 64 numbers.'); } };
    return;
  }
  const pk = burner.publicKey.toBase58();
  $('#wallet').innerHTML = `<div class="key">${pk}</div><div id="bal">Balance: loading</div><div class="row"><button class="btn sm" id="exp">Export key</button><button class="btn sm ghost" id="wipe">Delete</button></div>`;
  $('#exp').onclick = () => prompt('Secret key. Anyone with it controls the wallet.', JSON.stringify([...burner.secretKey]));
  $('#wipe').onclick = () => { if (confirm('Delete this burner from the browser? Export the key first if it holds funds.')) { burner = null; LS.del('cs_burner'); renderWallet(); } };
  try { const r = await fetch(`/api/balance/${pk}`, { headers: authH() }); $('#bal').textContent = `Balance: ${(await r.json()).sol?.toFixed(4)} SOL`; } catch { $('#bal').textContent = 'Balance: unavailable'; }
}

/* ---------- trading ---------- */
async function trade(action, mint, amount, inSol) {
  const r = await fetch('/api/trade', { method: 'POST', headers: authH(), body: JSON.stringify({ publicKey: burner.publicKey.toBase58(), action, mint, amount, denominatedInSol: inSol, slippage: S.slippage, priorityFee: S.priorityFee }) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error);
  const vt = VersionedTransaction.deserialize(unb64(j.tx)); vt.sign([burner]);
  const s = await fetch('/api/send', { method: 'POST', headers: authH(), body: JSON.stringify({ tx: b64(vt.serialize()) }) });
  const sj = await s.json(); if (!s.ok) throw new Error(sj.error);
  return sj.signature;
}
const positions = []; const seen = new Set(); let spent = 0, armed = false;
const log = m => { const l = $('#log'); l.insertAdjacentHTML('afterbegin', `<div>${new Date().toLocaleTimeString()} ${esc(m)}</div>`); while (l.children.length > 60) l.lastChild.remove(); };
function paintPositions() {
  $('#posList').innerHTML = positions.length ? positions.map((p, i) => `<div class="item hit"><span class="sym">${esc(p.symbol)}</span><span class="tag buy">${p.dry ? 'dry run' : p.sold ? 'sold' : 'open'}</span><span class="meta">${p.sol} SOL <a target="_blank" rel="noopener" href="https://solscan.io/tx/${esc(p.sig)}">tx</a></span>${!p.dry && !p.sold ? `<button class="btn sm" data-sell="${i}">Sell 100%</button>` : '<span></span>'}</div>`).join('') : '<p class="empty">No positions yet. Arm the sniper to start.</p>';
}
$('#posList').onclick = async e => {
  const i = e.target.dataset.sell; if (i === undefined) return; await sell(positions[i]);
};
async function sell(p) {
  if (p.sold) return; p.sold = true; paintPositions();
  try { const sig = await trade('sell', p.mint, '100%', false); log(`Sold ${p.symbol}: ${sig.slice(0, 12)}`); }
  catch (e) { p.sold = false; paintPositions(); log(`Sell failed for ${p.symbol}: ${e.message}`); }
}
function verdict(e) {
  if (seen.has(e.mint)) return 'duplicate';
  if (e.devBuySol < S.minDevBuy) return `dev buy ${e.devBuySol.toFixed(2)} below min`;
  if (e.devBuySol > S.maxDevBuy) return `dev buy ${e.devBuySol.toFixed(2)} above max`;
  const hay = `${e.name} ${e.symbol}`.toLowerCase();
  const bad = S.blocklist.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).find(w => hay.includes(w));
  if (bad) return `blocklisted "${bad}"`;
  if (positions.filter(p => !p.sold && !p.dry).length >= S.maxPositions && !S.dryRun) return 'position cap reached';
  if (!S.dryRun && spent + S.buySol > S.sessionCap) return 'session cap reached';
  return null;
}
async function snipe(e) {
  seen.add(e.mint);
  if (S.dryRun) { positions.unshift({ mint: e.mint, symbol: e.symbol, sol: S.buySol, sig: '', dry: true }); paintPositions(); log(`DRY RUN would buy ${e.symbol} for ${S.buySol} SOL`); return; }
  if (!burner) return log('Buy skipped. Generate or import a burner wallet first.');
  spent += S.buySol;
  try {
    const sig = await trade('buy', e.mint, S.buySol, true);
    const p = { mint: e.mint, symbol: e.symbol, sol: S.buySol, sig };
    positions.unshift(p); paintPositions(); log(`Bought ${e.symbol}: ${sig.slice(0, 12)}`);
    if (S.holdSec > 0) setTimeout(() => sell(p), S.holdSec * 1000);
  } catch (err) { spent -= S.buySol; log(`Buy failed for ${e.symbol}: ${err.message}`); }
}
function onLaunch(e) {
  addBlip(true);
  const why = armed ? verdict(e) : 'sniper disarmed';
  const list = $('#feedList'); if (list.querySelector('.empty')) list.innerHTML = '';
  list.insertAdjacentHTML('afterbegin', `<div class="item ${why ? 'skip' : 'hit'}"><span class="sym">${esc(e.symbol)} <span class="meta">${esc(e.name)}</span></span><span class="tag ${why ? '' : 'buy'}">${why ? 'skip' : 'snipe'}</span><span class="meta">dev ${e.devBuySol.toFixed(2)} SOL, mc ${e.mcSol.toFixed(1)} SOL</span><a class="meta" target="_blank" rel="noopener" href="https://pump.fun/coin/${esc(e.mint)}">chart</a></div>`);
  while (list.children.length > 60) list.lastChild.remove();
  if (armed && !why) snipe(e);
}
function paintArm() {
  const b = $('#arm'), s = $('#armState');
  b.textContent = armed ? 'Disarm sniper' : 'Arm sniper';
  b.className = 'btn ' + (armed && !S.dryRun ? 'live' : 'primary');
  s.textContent = !armed ? 'Disarmed' : S.dryRun ? 'Armed, dry run' : 'Armed, live';
  s.className = 'pill ' + (!armed ? 'off' : S.dryRun ? '' : 'hot');
}
$('#arm').onclick = () => {
  if (!armed && !S.dryRun && !burner) return log('Generate or import a burner wallet before going live.');
  if (!armed && !S.dryRun && !confirm(`Go live? The bot will spend up to ${S.sessionCap} SOL this session. Most new memecoins go to zero.`)) return;
  armed = !armed; paintArm(); log(armed ? 'Sniper armed.' : 'Sniper disarmed.');
};

/* ---------- app entry ---------- */
let es;
function enterApp() {
  document.body.classList.add('in'); $('#gate').hidden = true; $('#app').hidden = false;
  $('#lic').hidden = false; $('#lic').textContent = 'License active';
  renderForm(); renderWallet(); paintArm();
  es?.close(); es = new EventSource(`/api/stream?token=${encodeURIComponent(LS.get('cs_token'))}`);
  es.onopen = () => { live = true; $('#feedState').textContent = 'Feed live'; $('#feedState').className = 'pill'; };
  es.onerror = () => { live = false; $('#feedState').textContent = 'Reconnecting'; $('#feedState').className = 'pill off'; if (es.readyState === 2) { LS.del('cs_token'); location.reload(); } };
  es.onmessage = m => { try { onLaunch(JSON.parse(m.data)); } catch {} };
}
if (LS.get('cs_token')) enterApp();
