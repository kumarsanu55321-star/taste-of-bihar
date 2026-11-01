import { requireSupabase } from './supabase';

export type ContestStatus = {
  registration_state: 'setup' | 'open' | 'closed';
  server_time: string;
  registration_deadline?: string | null;
  registration_deadline_passed?: boolean;
};

export type ContestRegistrationResult = {
  registered: true;
};

function throwRpcError(error: { code?: string; message?: string }) {
  const message = error.message || 'The contest service could not complete your request.';
  if (message.includes('invalid_gmail')) throw new Error('Enter a valid Gmail address ending in @gmail.com.');
  if (message.includes('invalid_display_name')) throw new Error('Enter a name using 1–40 letters, spaces, apostrophes or hyphens.');
  if (message.includes('registration_confirmation_required')) throw new Error('Please confirm your registration before continuing.');
  if (message.includes('contest_registration_closed') || message.includes('contest_registration_deadline_passed')) {
    throw new Error('Registrations are now closed.');
  }
  if (message.includes('contest_registration_not_started')) throw new Error('Registration status is out of date. Please refresh and try again.');
  if (error.code === 'PGRST202' || error.code === '42883') throw new Error('Contest registration is not configured yet. Please try again later.');
  throw new Error(message);
}

export async function getContestStatus(): Promise<ContestStatus> {
  const { data, error } = await requireSupabase().rpc('contest_get_status');
  if (error) throwRpcError(error);
  if (!data || typeof data !== 'object' || !('registration_state' in data) || !('server_time' in data)
      || Number.isNaN(Date.parse(String(data.server_time)))) {
    throw new Error('The contest registration status is unavailable.');
  }
  return data as ContestStatus;
}

export async function contestRegister(displayName: string, email: string, confirm: boolean): Promise<ContestRegistrationResult> {
  const { data, error } = await requireSupabase().rpc('contest_register', {
    p_display_name: displayName.trim(),
    p_gmail: email.trim().toLowerCase(),
    p_confirm: confirm,
  });
  if (error) throwRpcError(error);
  if (!data || typeof data !== 'object' || !('registered' in data)) {
    throw new Error('The contest service returned an invalid registration response.');
  }
  return data as ContestRegistrationResult;
}
