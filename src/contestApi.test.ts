import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createClientMock, rpcMock } = vi.hoisted(() => ({ createClientMock: vi.fn(), rpcMock: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }));

describe('anonymous contest RPC client', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-test-key');
    rpcMock.mockReset();
    createClientMock.mockReset().mockReturnValue({ rpc: rpcMock });
  });

  it('reads public campaign status without creating participant auth sessions', async () => {
    const status = { registration_state: 'open', server_time: '2026-11-01T07:30:00Z' };
    rpcMock.mockResolvedValue({ data: status, error: null });
    const { getContestStatus } = await import('./contestApi');
    expect(await getContestStatus()).toEqual(status);
    expect(rpcMock).toHaveBeenCalledWith('contest_get_status');
  });

  it('sends trimmed name, lower-case Gmail and explicit confirmation only to the RPC', async () => {
    const result = { registered: true };
    rpcMock.mockResolvedValue({ data: result, error: null });
    const { contestRegister } = await import('./contestApi');
    expect(await contestRegister(' Asha ', ' ASHA@GMAIL.COM ', true)).toEqual(result);
    expect(rpcMock).toHaveBeenCalledWith('contest_register', {
      p_display_name: 'Asha', p_gmail: 'asha@gmail.com', p_confirm: true,
    });
  });

  it('maps registration, eligibility and schedule errors to useful messages', async () => {
    const { contestRegister } = await import('./contestApi');
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'invalid_gmail' } });
    await expect(contestRegister('Asha', 'bad', true)).rejects.toThrow('valid Gmail address');
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'contest_registration_closed' } });
    await expect(contestRegister('Asha', 'asha@gmail.com', true)).rejects.toThrow('Registrations are now closed');
  });

  it('fails closed when the registration RPC is not installed', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function not found' } });
    const { contestRegister } = await import('./contestApi');
    await expect(contestRegister('Asha', 'asha@gmail.com', true)).rejects.toThrow('not configured yet');
  });
});
