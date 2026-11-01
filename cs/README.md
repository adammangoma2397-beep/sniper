# Crypto Sniper
Solana memecoin sniper. Pay 1 SOL to unlock. Burner wallet stays in the browser.

## Run locally
    npm install
    cp .env.example .env   # fill LICENSE_SECRET and RPC_URL
    export $(grep -v '^#' .env | xargs) && npm start

## Deploy (GitHub -> Render, free tier)
1. Push this folder to a GitHub repo.
2. Render dashboard -> New -> Blueprint -> pick the repo (reads render.yaml).
3. Set RPC_URL (a Helius or QuickNode mainnet URL).
4. Optional: add the service's Deploy Hook as the RENDER_DEPLOY_HOOK GitHub secret so the Actions workflow redeploys on every push.
