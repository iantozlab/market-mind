# Polymarket Order Signing - Secure Backend Setup Guide

This guide walks through setting up secure server-side order signing for Polymarket orders using Supabase Edge Functions.

## Architecture Overview

- **Private Key Storage**: Securely stored in Supabase Edge Function secrets (never in frontend or `.env`)
- **Signing Endpoint**: `/functions/v1/sign-polymarket-order` (Edge Function)
- **Frontend Integration**: Uses `signOrderViaBackend()` function from `neural-bot-engine.ts`
- **Authentication**: Optional JWT verification for additional security

---

## STEP 1: Edge Function Created ✓

The file `supabase/functions/sign-polymarket-order/index.ts` has been created with:
- EIP-712 signing support
- Supabase authentication verification
- CORS headers for frontend access
- Error handling with masked secrets

---

## STEP 2: Store Secrets in Supabase Edge Function

The private key and API credentials must be stored securely in Supabase, NOT in `.env` or frontend code.

### Prerequisites
- Supabase CLI installed: `npm install -g supabase`
- Access to your Supabase project

### Commands to Run

```bash
# Log in to Supabase CLI
supabase login

# Link your project (use your project ref)
supabase link --project-ref buvepdnnsurgfthtgtyz

# Set the secrets (REPLACE with your actual values)
supabase secrets set POLYMARKET_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE
supabase secrets set POLYMARKET_API_KEY=your_api_key
supabase secrets set POLYMARKET_SECRET=your_secret
supabase secrets set POLYMARKET_PASSPHRASE=your_passphrase
```

### Verify Secrets Were Set
```bash
supabase secrets list
```

### Example with Real Values
```bash
# DO NOT commit these commands with real values
supabase secrets set POLYMARKET_PRIVATE_KEY=0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
supabase secrets set POLYMARKET_API_KEY=pk_live_abc123...
```

---

## STEP 3: Deploy the Edge Function

### Deploy the signing function to your Supabase project

```bash
# Deploy without JWT verification (we handle auth manually in the function)
supabase functions deploy sign-polymarket-order --no-verify-jwt
```

### Why `--no-verify-jwt`?
- We implement manual authentication verification inside the function
- This gives us fine-grained control over when signing is allowed
- The function checks the Authorization header and verifies the JWT with Supabase

### Verify Deployment
```bash
# Check function logs (if deployed)
supabase functions list
```

### Test the Function (Optional)
```bash
# Get your JWT token first (if using Supabase Auth)
# Then test with curl:
curl -X POST \
  https://buvepdnnsurgfthtgtyz.supabase.co/functions/v1/sign-polymarket-order \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "orderData": { "orderHash": "0x..." },
    "domain": { "name": "Polymarket", "chainId": 137 },
    "types": { "Order": [...] },
    "primaryType": "Order"
  }'
```

---

## STEP 4: Frontend Integration

The frontend now uses `signOrderViaBackend()` from `src/lib/neural-bot-engine.ts`:

### Usage Example

```typescript
import { signOrderViaBackend } from '@/lib/neural-bot-engine';

// In your order signing code:
const order = {
  salt: '123456',
  maker: userAddress,
  // ... other fields
};

const domain = {
  name: 'Polymarket',
  version: '1',
  chainId: 137,
  verifyingContract: '0x...',
};

const types = {
  Order: [
    { name: 'salt', type: 'uint256' },
    { name: 'maker', type: 'address' },
    // ... other fields
  ],
};

try {
  const result = await signOrderViaBackend(order, domain, types, 'Order');
  console.log('Signature:', result.signature);
  console.log('Signer Address:', result.signerAddress);
  
  // Use the signature in your order submission
  // POST to Polymarket API with the signed order
} catch (error) {
  console.error('Failed to sign order:', error);
}
```

### How It Works

1. **Frontend**: Calls `signOrderViaBackend()` with order data
2. **Backend**: Edge Function receives the request
3. **Verification**: Checks Authorization header (JWT token)
4. **Signing**: Uses the private key from secrets to sign the order
5. **Response**: Returns signature and signer address
6. **Frontend**: Uses signature in Polymarket API calls

---

## Security Checklist

- ✅ Private key stored in Supabase secrets (not in code, `.env`, or frontend)
- ✅ Edge Function verifies user authentication before signing
- ✅ CORS headers configured for frontend requests
- ✅ No secrets logged or exposed in error messages
- ✅ Backend handles all cryptographic operations
- ✅ Frontend only handles order data structure, never keys

---

## Troubleshooting

### "Server signing key not configured"
- Run `supabase secrets set POLYMARKET_PRIVATE_KEY=0x...`
- Verify the secret is listed with `supabase secrets list`
- Redeploy the function

### "Unauthorized" response
- Check that JWT token is being sent in Authorization header
- Verify the token is valid and not expired
- Check Supabase logs: `supabase functions logs sign-polymarket-order`

### CORS errors
- Ensure `Access-Control-Allow-Origin` is set correctly in the Edge Function
- Check browser console for specific error details

### "Failed to sign order"
- Check the error message returned from the Edge Function
- Verify order data, domain, and types are properly formatted
- Check that the private key has the correct format (0x-prefixed hex)

---

## Environment Variables Reference

| Variable | Location | Purpose |
|----------|----------|---------|
| `POLYMARKET_PRIVATE_KEY` | Supabase Secrets | Private key for signing orders |
| `POLYMARKET_API_KEY` | Supabase Secrets | API authentication for Polymarket |
| `POLYMARKET_SECRET` | Supabase Secrets | Additional API secret |
| `POLYMARKET_PASSPHRASE` | Supabase Secrets | Passphrase for API access |
| `SUPABASE_URL` | Supabase Secrets | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase Secrets | Supabase anonymous key |

---

## Next Steps

1. **Set the secrets** using the commands in STEP 2
2. **Deploy the function** using the command in STEP 3
3. **Update your order submission code** to use `signOrderViaBackend()`
4. **Test in development** before using with real orders
5. **Monitor logs** in Supabase dashboard for any issues

---

## References

- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [EIP-712 Signing](https://eips.ethereum.org/EIPS/eip-712)
- [Viem Documentation](https://viem.sh/)
- [Polymarket API](https://polymarket.com/)
