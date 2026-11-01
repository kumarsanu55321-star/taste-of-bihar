/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContestRegistration } from './ContestRegistration';

const { getContestStatus, contestRegister } = vi.hoisted(() => ({
  getContestStatus: vi.fn(),
  contestRegister: vi.fn(),
}));
vi.mock('../contestApi', () => ({ getContestStatus, contestRegister }));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-01T07:30:00Z'));
  getContestStatus.mockResolvedValue({ registration_state: 'open', server_time: '2026-11-01T07:30:00Z' });
  contestRegister.mockReset().mockResolvedValue({ registered: true, already_registered: false, id: 1, display_name: 'Asha Kumar', registered_at: '2026-11-01T07:30:00Z' });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

describe('account-free contest registration', () => {
  it('collects a name and normalized Gmail address and requires explicit confirmation', async () => {
    render(<ContestRegistration />);
    await screen.findByText('Registrations are now open!');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Enter your name'), { target: { value: 'Asha Kumar' } });
    fireEvent.change(screen.getByPlaceholderText('you@gmail.com'), { target: { value: '  ASHA@gmail.com ' } });
    const submit = screen.getByRole('button', { name: /REGISTER NOW/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(contestRegister).toHaveBeenCalledWith('Asha Kumar', 'asha@gmail.com', true));
    const success = await screen.findByRole('dialog', { name: 'Registration Successful!' });
    expect(success.textContent).toContain("You're officially registered for the Parivartan 2K26 Lucky Draw!");
    expect(success.textContent).toContain("Want to know who wins? Join our official WhatsApp group. We'll announce all five lucky winners there after registrations close.");
    const invite = screen.getByRole('link', { name: /JOIN WHATSAPP GROUP/i });
    expect(invite.getAttribute('href')).toBe('https://chat.whatsapp.com/KIFy7dhkxsI72U7RXbrR8x');
    expect(invite.getAttribute('target')).toBe('_blank');
    expect(invite.getAttribute('rel')).toContain('noopener');
    fireEvent.click(screen.getByRole('button', { name: /CONTINUE TO WEBSITE/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('asha@gmail.com')).toBeNull();
  });

  it('allows registration immediately before the previously scheduled opening time', async () => {
    vi.setSystemTime(new Date('2026-11-01T07:30:00Z'));
    getContestStatus.mockResolvedValueOnce({ registration_state: 'open', server_time: '2026-11-01T07:30:00Z' });
    render(<ContestRegistration />);
    expect(await screen.findByText('Registrations are now open!')).toBeTruthy();
    const submit = screen.getByRole('button', { name: /REGISTER NOW/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit.disabled).toBe(false);
  });

  it('shows an IST countdown while registration is open', async () => {
    vi.setSystemTime(new Date('2035-01-01T00:00:00Z'));
    getContestStatus.mockResolvedValueOnce({ registration_state: 'open', server_time: '2026-11-01T06:30:00Z' });
    render(<ContestRegistration />);
    expect(await screen.findByText('Registrations are now open!')).toBeTruthy();
    expect(screen.getByText(/Closes in/)).toBeTruthy();
    expect(screen.getByText('IST')).toBeTruthy();
  });

  it('disables registration at the exact close boundary', async () => {
    getContestStatus.mockResolvedValueOnce({ registration_state: 'closed', server_time: '2026-11-04T12:30:00Z', registration_deadline_passed: true });
    render(<ContestRegistration />);
    expect(await screen.findByText('Registrations are now closed. Join our WhatsApp group to find out who wins!')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'REGISTRATION CLOSED' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('rejects non-Gmail addresses before requesting registration', async () => {
    render(<ContestRegistration />);
    await screen.findByText('Registrations are now open!');
    fireEvent.change(screen.getByPlaceholderText('Enter your name'), { target: { value: 'Asha' } });
    fireEvent.change(screen.getByPlaceholderText('you@gmail.com'), { target: { value: 'asha@example.com' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /REGISTER NOW/i }));
    expect((await screen.findByRole('alert')).textContent).toContain('Enter a Gmail address ending in @gmail.com.');
    expect(contestRegister).not.toHaveBeenCalled();
  });

  it('shows the success popup for the privacy-preserving generic duplicate response', async () => {
    contestRegister.mockResolvedValueOnce({ registered: true });
    render(<ContestRegistration />);
    await screen.findByText('Registrations are now open!');
    fireEvent.change(screen.getByPlaceholderText('Enter your name'), { target: { value: 'Another Name' } });
    fireEvent.change(screen.getByPlaceholderText('you@gmail.com'), { target: { value: 'existing@gmail.com' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /REGISTER NOW/i }));
    expect(await screen.findByRole('dialog', { name: 'Registration Successful!' })).toBeTruthy();
    expect(screen.queryByText('existing@gmail.com')).toBeNull();
  });

  it('does not show the success popup when registration fails', async () => {
    contestRegister.mockRejectedValueOnce(new Error('The registration service is unavailable.'));
    render(<ContestRegistration />);
    await screen.findByText('Registrations are now open!');
    fireEvent.change(screen.getByPlaceholderText('Enter your name'), { target: { value: 'Asha Kumar' } });
    fireEvent.change(screen.getByPlaceholderText('you@gmail.com'), { target: { value: 'asha@gmail.com' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /REGISTER NOW/i }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
