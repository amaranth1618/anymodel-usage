import {
  QUOTA_PROVIDER_ERROR_MESSAGE_MAX,
  type QuotaProviderCredential,
  type QuotaProviderUsageData,
  type QuotaProviderWindow,
} from '@openchamber/sdk';

// https://anymodel.org/api-docs.md documents the balance payload; the FAQ
// defines one million balance tokens as $0.05.
export const BALANCE_URL = 'https://anymodel.org/v1/balance';
export const TOKEN_TO_USD = 0.05 / 1_000_000;

const failure = (error: string): QuotaProviderUsageData => ({
  ok: false,
  configured: true,
  error: error.slice(0, QUOTA_PROVIDER_ERROR_MESSAGE_MAX),
  usage: null,
});

const balanceWindow = (valueLabel: string): QuotaProviderWindow => ({ usedPercent: null, valueLabel });

const parseBalance = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const formatTokens = (balance: number): string => {
  const rounded = Math.round(balance * 10) / 10;
  return Number.isInteger(rounded)
    ? rounded.toLocaleString('en-US')
    : rounded.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
};

/**
 * Maps the AnyModel balance payload to the windows a built-in provider
 * computes. `unlimited: true` means the key has no balance to report; a
 * missing or malformed `balance` is null, never zero.
 */
export const buildUsageWindows = (payload: unknown): { windows: Record<string, QuotaProviderWindow> } | null => {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  if (record.unlimited === true) {
    return { windows: { credits_balance: balanceWindow('Unlimited') } };
  }
  const balance = parseBalance(record.balance);
  if (balance === null) return null;
  return {
    windows: {
      credits_balance: balanceWindow(`$${(balance * TOKEN_TO_USD).toFixed(2)}`),
      credits: balanceWindow(formatTokens(balance)),
    },
  };
};

export const bearerOf = (credential: QuotaProviderCredential): string => (
  credential.type === 'api' ? credential.key : credential.access
);

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export const readUsage = async (
  credential: QuotaProviderCredential | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<QuotaProviderUsageData> => {
  if (!credential) {
    return { ok: false, configured: false, error: 'Not configured', usage: null };
  }
  let response: Response;
  try {
    response = await fetchImpl(BALANCE_URL, {
      headers: { authorization: `Bearer ${bearerOf(credential)}`, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return failure(`AnyModel did not answer: ${error instanceof Error ? error.message : String(error)}.`);
  }
  if (response.status === 401 || response.status === 403) {
    return failure('AnyModel refused the key. Make a new one and store it for the anymodel provider in Settings → Providers.');
  }
  if (!response.ok) return failure(`AnyModel answered ${response.status}.`);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return failure('AnyModel answered with something other than JSON.');
  }
  const usage = buildUsageWindows(payload);
  if (!usage) return failure('AnyModel answered without a balance.');
  return { ok: true, configured: true, usage };
};
