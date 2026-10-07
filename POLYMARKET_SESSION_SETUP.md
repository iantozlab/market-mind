# Polymarket Session-Key Trading Setup

The bot uses a Deposit Wallet and a server-side EOA Session Key for CLOB orders. The wallet owner must authorize that exact signer for the `CLOB` scope before LIVE mode can place orders. Session-key authorization is separate from funding and trading-token approvals.

## Server secrets

Provision a dedicated Polygon EOA key for the bot through your secrets manager. Do not reuse the account owner key, expose this key to the browser, or commit it. Configure these Supabase Edge Function secrets:

```sh
supabase secrets set POLYMARKET_SESSION_PRIVATE_KEY=0x<dedicated-session-key>
supabase secrets set POLYMARKET_DEPOSIT_WALLET=0x<polymarket-deposit-wallet>
```

The Deposit Wallet must authorize the address derived from `POLYMARKET_SESSION_PRIVATE_KEY` with the `CLOB` scope. Follow Polymarket's current [Session Key guide](https://docs.polymarket.com/trading/session-keys) and verify the authorization is active before turning on LIVE mode. Keep existing `POLYMARKET_ALLOWED_ORIGIN`, Supabase authentication, and admin authorization configured for Edge Functions.

## Funding and approvals

On the Wallet page, connect a Polygon wallet and wrap USDC.e to pUSD. Set the Deposit Wallet address as the recipient. The app requests an exact USDC.e allowance and asks the wallet to confirm the wrap separately.

Trading requires the Deposit Wallet to hold enough pUSD and to approve the CTF, Neg Risk CTF, and Polymarket V2 exchange contracts. The Trade History retry monitor checks the configured Deposit Wallet's balance and allowances before it resends a confirmed balance/allowance rejection.

The session-key private key must belong to the Deposit Wallet selected in the server configuration. This deployment configuration is single-account; do not use it as a multi-tenant wallet service.

## Retry behavior

Only definitive CLOB balance/allowance rejection responses are eligible for retry. The optional automatic retry operates while the authenticated Trade History page is open, checks on-chain readiness first, and stops after three attempts. Timeouts, network errors, and unknown submission results are never retried automatically because the original order may already have reached Polymarket.
