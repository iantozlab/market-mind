import {
  createPublicClient,
  createWalletClient,
  custom,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseAbi,
  parseUnits,
  type Address,
  type EIP1193Provider,
} from 'viem';
import { polygon } from 'viem/chains';

export const POLYGON_USDCE_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' as Address;
export const POLYMARKET_PUSD_ADDRESS = '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB' as Address;
export const POLYMARKET_ONRAMP_ADDRESS = '0x93070a847efEf7F70739046A929D47a521F5B8ee' as Address;

const erc20Abi = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

const onrampAbi = parseAbi([
  'function wrap(address _asset, address _to, uint256 _amount)',
]);

export interface InjectedWalletConnection {
  provider: EIP1193Provider;
  address: Address;
}

export function parseUsdcAmount(amount: string, balance: bigint): bigint {
  if (!/^\d+(?:\.\d{1,6})?$/.test(amount.trim())) {
    throw new Error('Enter a positive amount with no more than 6 decimal places.');
  }

  const value = parseUnits(amount.trim(), 6);
  if (value <= 0n) throw new Error('Amount must be greater than zero.');
  if (value > balance) throw new Error('Amount exceeds the connected wallet USDC.e balance.');
  return value;
}

export function validateWalletAddress(value: string): Address {
  if (!isAddress(value.trim())) throw new Error('Enter a valid Polygon wallet address.');
  return getAddress(value.trim());
}

export async function connectInjectedWallet(): Promise<InjectedWalletConnection> {
  const provider = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
  if (!provider) throw new Error('No browser wallet detected. Install MetaMask, Rabby, or Coinbase Wallet.');

  const walletClient = createWalletClient({ chain: polygon, transport: custom(provider) });
  let chainId = await walletClient.getChainId();
  if (chainId !== polygon.id) {
    await walletClient.switchChain({ id: polygon.id });
    chainId = await walletClient.getChainId();
  }
  if (chainId !== polygon.id) throw new Error('Switch your wallet to Polygon before continuing.');

  const [address] = await walletClient.requestAddresses();
  if (!address) throw new Error('The wallet did not return an account.');
  return { provider, address };
}

export async function getWalletBalances(address: Address): Promise<{ usdce: bigint; pusd: bigint }> {
  const publicClient = createPublicClient({ chain: polygon, transport: http() });
  const [usdce, pusd] = await Promise.all([
    publicClient.readContract({ address: POLYGON_USDCE_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [address], authorizationList: [] }),
    publicClient.readContract({ address: POLYMARKET_PUSD_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [address], authorizationList: [] }),
  ]);
  return { usdce, pusd };
}

export function formatUsdc(value: bigint): string {
  return formatUnits(value, 6);
}

export async function wrapUsdcForPolymarket(
  connection: InjectedWalletConnection,
  recipient: Address,
  amount: bigint,
  onApprovalConfirmed?: (hash: `0x${string}`) => void,
): Promise<{ approvalHash?: `0x${string}`; wrapHash: `0x${string}` }> {
  if (amount <= 0n) throw new Error('Wrap amount must be greater than zero.');
  const walletClient = createWalletClient({ account: connection.address, chain: polygon, transport: custom(connection.provider) });
  const publicClient = createPublicClient({ chain: polygon, transport: http() });
  if (await walletClient.getChainId() !== polygon.id) throw new Error('Wallet network changed. Reconnect to Polygon.');

  const balance = await publicClient.readContract({
    address: POLYGON_USDCE_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [connection.address],
    authorizationList: [],
  });
  if (amount > balance) throw new Error('USDC.e balance changed; refresh the wallet balances and try again.');

  const allowance = await publicClient.readContract({
    address: POLYGON_USDCE_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [connection.address, POLYMARKET_ONRAMP_ADDRESS],
    authorizationList: [],
  });

  let approvalHash: `0x${string}` | undefined;
  if (allowance < amount) {
    approvalHash = await walletClient.writeContract({
      account: connection.address,
      chain: polygon,
      address: POLYGON_USDCE_ADDRESS,
      abi: erc20Abi,
      functionName: 'approve',
      args: [POLYMARKET_ONRAMP_ADDRESS, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash: approvalHash });
    onApprovalConfirmed?.(approvalHash);
  }

  if (await walletClient.getChainId() !== polygon.id) throw new Error('Wallet network changed. Switch back to Polygon before wrapping.');

  const wrapHash = await walletClient.writeContract({
    account: connection.address,
    chain: polygon,
    address: POLYMARKET_ONRAMP_ADDRESS,
    abi: onrampAbi,
    functionName: 'wrap',
    args: [POLYGON_USDCE_ADDRESS, recipient, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash: wrapHash });
  return { approvalHash, wrapHash };
}