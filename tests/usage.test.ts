import { describe, expect, test } from 'bun:test';

import { buildUsageWindows, formatTokens, readUsage } from '../service/usage';

describe('formatTokens', () => {
  const cases: Array<[number, string]> = [
    [4200000, '4,200,000'],
    [0, '0'],
    [25.5, '25.5'],
    [20000000, '20,000,000'],
  ];
  for (const [balance, label] of cases) {
    test(`formats ${balance}`, () => {
      expect(formatTokens(balance)).toBe(label);
    });
  }
});

describe('buildUsageWindows', () => {
  const mapCases: Array<[unknown, string, string]> = [
    [{ balance: 4200000 }, '$0.21', '4,200,000'],
    [{ balance: '4200000' }, '$0.21', '4,200,000'],
    [{ balance: 0 }, '$0.00', '0'],
    [{ balance: '0' }, '$0.00', '0'],
    [{ balance: 25.5 }, '$0.00', '25.5'],
    [{ balance: 20000000 }, '$1.00', '20,000,000'],
  ];
  for (const [payload, dollars, tokens] of mapCases) {
    test(`maps ${JSON.stringify(payload)} to dollars and tokens`, () => {
      const usage = buildUsageWindows(payload);
      expect(usage).not.toBeNull();
      expect(usage?.windows.credits_balance).toEqual({ usedPercent: null, valueLabel: dollars });
      expect(usage?.windows.credits).toEqual({ usedPercent: null, valueLabel: tokens });
    });
  }

  const unlimitedCases: unknown[] = [
    { unlimited: true },
    { unlimited: true, balance: 0 },
    { unlimited: true, balance: 'nonsense' },
  ];
  for (const payload of unlimitedCases) {
    test(`reports an unlimited key ${JSON.stringify(payload)} as Unlimited without numbers`, () => {
      const usage = buildUsageWindows(payload);
      expect(usage?.windows.credits).toBeUndefined();
      expect(usage?.windows.credits_balance).toEqual({ usedPercent: null, valueLabel: 'Unlimited' });
    });
  }

  const invalidCases: unknown[] = [
    {}, null, [], { balance: '' }, { balance: ' \t ' }, { balance: 'NaN' },
    { balance: 'Infinity' }, { balance: null }, { balance: true }, { balance: [] },
    { balance: {} },
  ];
  for (const payload of invalidCases) {
    test(`rejects invalid payload ${JSON.stringify(payload)} instead of showing zero`, () => {
      expect(buildUsageWindows(payload)).toBeNull();
    });
  }
});

describe('readUsage', () => {
  test('reads the balance with the key OpenCode holds for anymodel', async () => {
    let requests = 0;
    const result = await readUsage(
      { type: 'api', key: 'test-token' },
      async (url: string | URL | Request, options?: RequestInit) => {
        requests += 1;
        expect(url).toBe('https://anymodel.org/v1/balance');
        expect(new Headers(options?.headers).get('authorization')).toBe('Bearer test-token');
        expect(options?.redirect).toBe('error');
        expect(options?.signal).toBeInstanceOf(AbortSignal);
        return Response.json({ balance: 4200000 });
      },
    );
    expect(requests).toBe(1);
    expect(result).toMatchObject({
      ok: true,
      configured: true,
      usage: {
        windows: {
          credits_balance: { usedPercent: null, valueLabel: '$0.21' },
          credits: { usedPercent: null, valueLabel: '4,200,000' },
        },
      },
    });
  });

  test('a browser login access token serves as the bearer too', async () => {
    const result = await readUsage(
      { type: 'oauth', access: 'oauth-token', refresh: 'r', expires: 1_800_000_000_000 },
      async (_url: string | URL | Request, options?: RequestInit) => {
        expect(new Headers(options?.headers).get('authorization')).toBe('Bearer oauth-token');
        return Response.json({ balance: 0 });
      },
    );
    expect(result.ok).toBe(true);
  });

  test('answers not configured without a credential and makes no request', async () => {
    let requests = 0;
    const result = await readUsage(undefined, async () => {
      requests += 1;
      return Response.json({ balance: 1 });
    });
    expect(requests).toBe(0);
    expect(result).toEqual({ ok: false, configured: false, error: 'Not configured', usage: null });
  });

  const httpCases: Array<[number, string]> = [
    [401, 'refused the key'],
    [403, 'refused the key'],
    [429, 'answered 429'],
    [500, 'answered 500'],
  ];
  for (const [status, message] of httpCases) {
    test(`reports HTTP ${status} as a failure`, async () => {
      const result = await readUsage(
        { type: 'api', key: 'test-token' },
        async () => new Response(null, { status }),
      );
      expect(result.ok).toBe(false);
      expect(result.configured).toBe(true);
      expect(result.error).toContain(message);
      expect(result.usage).toBeNull();
    });
  }

  test('reports a non-JSON answer', async () => {
    const result = await readUsage({ type: 'api', key: 'test-token' }, async () => new Response('{'));
    expect(result).toMatchObject({ ok: false, configured: true, error: 'AnyModel answered with something other than JSON.', usage: null });
  });

  test('reports an answer without a balance', async () => {
    const result = await readUsage({ type: 'api', key: 'test-token' }, async () => Response.json({ status: 'active' }));
    expect(result).toMatchObject({ ok: false, configured: true, error: 'AnyModel answered without a balance.', usage: null });
  });

  test('reports a network failure', async () => {
    const result = await readUsage(
      { type: 'api', key: 'test-token' },
      async () => { throw new Error('Network unavailable'); },
    );
    expect(result.ok).toBe(false);
    expect(result.configured).toBe(true);
    expect(result.error).toContain('Network unavailable');
    expect(result.usage).toBeNull();
  });
});
