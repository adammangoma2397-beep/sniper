import express from 'express';
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import { Connection, PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import WebSocket from 'ws';

const PORT = Number(process.env.PORT) || 3000;
const PAY_WALLET = process.env.PAY_WALLET || 'HQ7Fp1W1AjkBF5j6pQMKHfTPRUZxqVr72cPNs5cYDz3D';
const PRICE_SOL = Number(process.env.PRICE_SOL) || 1;
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const SECRET = process.env.LICENSE_SECRET;
if (!SECRET || SECRET.length < 16) { console.error('LICENSE_SECRET must be set (16+ chars).'); process.exit(1); }

const conn = new Connection(RPC_URL, 'confirmed');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,90}$/;

const app = express();
app.use(express.json({ limit: '64kb' }));
app.use(express.static('public'));

const hits = new Map();
const limit = (max, windowMs) => (req, res, next) => {
  const k = `${req.ip}:${req.path}`, now = Date.now();
  const h = (hits.get(k) || []).filter(t => now - t < windowMs);
  if (h.length >= max) return res.status(429).json({ error: 'Too many requests. Wait a minute.' });
  h.push(now); hits.set(k, h); next();
};

const sign = body => crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
const issueToken = payload => { const b = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${b}.${sign(b)}`; };
function readToken(t) {
  if (!t || !t.includes('.')) return null;
  const [b, mac] = t.split('.');
  const good = Buffer.from(sign(b)), got = Buffer.from(mac);
  if (good.length !== got.length || !crypto.timingSafeEqual(good, got)) return null;
  try { return JSON.parse(Buffer.from(b, 'base64url').toString()); } catch { return null; }
}
const auth = (req, res, next) => {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '') || req.query.token;
  const lic = readToken(t);
  if (!lic) return res.status(401).json({ error: 'License missing or invalid. Unlock Crypto Sniper first.' });
  req.license = lic; next();
};

app.get('/healthz', (_, res) => res.send('ok'));
app.get('/api/config', (_, res) => res.json({ payWallet: PAY_WALLET, priceSol: PRICE_SOL }));
app.get('/api/blockhash', async (_, res) => {
  try { res.json(await conn.getLatestBlockhash('finalized')); } catch { res.status(502).json({ error: 'RPC unavailable.' }); }
});

async function fetchTx(signature) {
  for (let i = 0; i < 14; i++) {
    const tx = await conn.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null);
    if (tx) return tx;
    await sleep(1500);
  }
  return null;
}

app.post('/api/verify', limit(10, 60_000), async (req, res) => {
  const { payer, signature, proof } = req.body || {};
  if (!B58.test(payer || '') || !B58.test(signature || '') || typeof proof !== 'string')
    return res.status(400).json({ error: 'Bad request.' });
  try {
    const msg = new TextEncoder().encode(`crypto-sniper:${signature}`);
    const okProof = nacl.sign.detached.verify(msg, Buffer.from(proof, 'base64'), new PublicKey(payer).toBytes());
    if (!okProof) return res.status(403).json({ error: 'Wallet proof failed. Sign with the wallet that paid.' });
    const tx = await fetchTx(signature);
    if (!tx) return res.status(404).json({ error: 'Transaction not found yet. Retry in a few seconds.' });
    if (tx.meta?.err) return res.status(402).json({ error: 'That transaction failed on-chain.' });
    const need = Math.round(PRICE_SOL * 1e9);
    const paid = tx.transaction.message.instructions.some(ix =>
      ix.program === 'system' && ix.parsed?.type === 'transfer' &&
      ix.parsed.info.source === payer && ix.parsed.info.destination === PAY_WALLET &&
      Number(ix.parsed.info.lamports) >= need);
    if (!paid) return res.status(402).json({ error: `No ${PRICE_SOL} SOL transfer to the Crypto Sniper wallet found in that transaction.` });
    res.json({ token: issueToken({ p: payer, s: signature, t: Date.now() }) });
  } catch (e) { res.status(500).json({ error: 'Verification error: ' + e.message }); }
});

const clients = new Set();
const broadcast = o => { const d = `data: ${JSON.stringify(o)}\n\n`; for (const c of clients) c.write(d); };

app.get('/api/stream', auth, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  clients.add(res);
  const hb = setInterval(() => res.write(':hb\n\n'), 20_000);
  req.on('close', () => { clearInterval(hb); clients.delete(res); });
});

app.get('/api/balance/:pk', auth, async (req, res) => {
  if (!B58.test(req.params.pk)) return res.status(400).json({ error: 'Bad address.' });
  try { res.json({ sol: (await conn.getBalance(new PublicKey(req.params.pk))) / 1e9 }); }
  catch { res.status(502).json({ error: 'RPC unavailable.' }); }
});

app.post('/api/trade', auth, limit(60, 60_000), async (req, res) => {
  const { publicKey, action, mint, amount, denominatedInSol, slippage, priorityFee } = req.body || {};
  const amt = typeof amount === 'string' && /^\d{1,3}%$/.test(amount) ? amount : Number(amount);
  if (!B58.test(publicKey || '') || !B58.test(mint || '') || !['buy', 'sell'].includes(action) ||
      !(typeof amt === 'string' || (amt > 0 && amt <= 10)) ||
      !(Number(slippage) >= 1 && Number(slippage) <= 99) || !(Number(priorityFee) >= 0 && Number(priorityFee) <= 0.1))
    return res.status(400).json({ error: 'Trade parameters rejected.' });
  try {
    const r = await fetch('https://pumpportal.fun/api/trade-local', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publicKey, action, mint, amount: amt, denominatedInSol: String(denominatedInSol), slippage: Number(slippage), priorityFee: Number(priorityFee), pool: 'auto' })
    });
    if (!r.ok) return res.status(502).json({ error: `Trade builder: ${(await r.text()).slice(0, 200)}` });
    res.json({ tx: Buffer.from(await r.arrayBuffer()).toString('base64') });
  } catch (e) { res.status(502).json({ error: 'Trade builder unreachable: ' + e.message }); }
});

app.post('/api/send', auth, limit(60, 60_000), async (req, res) => {
  try {
    const raw = Buffer.from(String(req.body?.tx || ''), 'base64');
    if (raw.length < 100 || raw.length > 1500) return res.status(400).json({ error: 'Bad transaction.' });
    res.json({ signature: await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 3 }) });
  } catch (e) { res.status(502).json({ error: 'Send failed: ' + e.message }); }
});

let backoff = 1000;
function feed() {
  const ws = new WebSocket('wss://pumpportal.fun/api/data');
  ws.on('open', () => { backoff = 1000; ws.send(JSON.stringify({ method: 'subscribeNewToken' })); console.log('launch feed live'); });
  ws.on('message', buf => {
    try {
      const m = JSON.parse(buf.toString());
      if (m.txType !== 'create' || !m.mint) return;
      broadcast({ mint: m.mint, name: m.name, symbol: m.symbol, dev: m.traderPublicKey, devBuySol: Number(m.solAmount) || 0, mcSol: Number(m.marketCapSol) || 0, uri: m.uri, ts: Date.now() });
    } catch {}
  });
  ws.on('close', () => { console.log(`feed closed, retry in ${backoff}ms`); setTimeout(feed, backoff); backoff = Math.min(backoff * 2, 30_000); });
  ws.on('error', () => ws.close());
}
feed();

createServer(app).listen(PORT, () => console.log(`Crypto Sniper on :${PORT}`));
