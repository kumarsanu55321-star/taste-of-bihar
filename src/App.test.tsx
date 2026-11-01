/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { getContestStatus } from './contestApi';
import { menuItems } from './campaign';

vi.mock('./contestApi', () => ({
  getContestStatus: vi.fn().mockResolvedValue({ registration_state: 'open', server_time: '2026-11-01T07:30:00Z' }),
  contestRegister: vi.fn(),
}));

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
beforeEach(() => {
  vi.mocked(getContestStatus).mockReset().mockResolvedValue({ registration_state: 'open', server_time: '2026-11-01T07:30:00Z' });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});

describe('Parivartan 2K26 public campaign', () => {
  it('uses the supplied Parivartan logo in the header and footer', () => {
    const { container } = render(<App />);
    const logos = container.querySelectorAll<HTMLImageElement>('.brand-logo, .footer-logo');
    expect(logos).toHaveLength(2);
    for (const logo of logos) {
      expect(logo.getAttribute('src')).toBe('/images/parivartan-litti-chokha-logo.png');
      expect(logo.getAttribute('alt')).toBe('Parivartan 2K26 — Bihar Special Litti Chokha');
    }
  });

  it('preserves branding, original menu artwork, story, food cards and location sections', async () => {
    const { container } = render(<App />);
    expect(screen.getByRole('heading', { name: 'THE TASTE OF BIHAR' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Our Menu' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Litti Chokha' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'The Story Behind Litti Chokha' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Stall favourites' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Find our stall' })).toBeTruthy();
    const quoteFlowers = container.querySelectorAll('.bihar-quote .quote-flower');
    expect(quoteFlowers).toHaveLength(2);
    expect([...quoteFlowers].map((flower) => flower.textContent)).toEqual(['✿', '✿']);
    expect(container.querySelector('.bihar-quote p')?.textContent).toBe('A taste of Bihar’s soul,right at Parivartan.');
    const signatureImage = container.querySelector<HTMLImageElement>('.signature-dish-image img');
    expect(signatureImage?.getAttribute('src')).toBe('/images/litti-chokha-platter.png');
    expect(signatureImage?.alt).toContain('Charcoal-roasted Litti Chokha');
    expect(container.querySelector('.signature-dish-description')?.textContent).toBe('Savour our charcoal-roasted Litti Chokha, featuring ghee-dipped wheat balls stuffed with spiced sattu, served alongside a smoky eggplant-tomato mash and a touch of vibrant, tangy mint-coriander chutney—a rustic, soul-warming bite of authentic North Indian tradition.');
    expect(container.querySelector('.dish-active .dish-photo-label')?.textContent).toBe('MOST LOVED');
    const signatureDish = container.querySelector('.signature-dish');
    const storySection = container.querySelector('#story');
    expect(signatureDish && storySection && Boolean(signatureDish.compareDocumentPosition(storySection) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(screen.getByRole('button', { name: 'REGISTER NOW' })).toBeTruthy();
    expect(screen.queryByText(/SPIN NOW|Lucky Spin|coupon/i)).toBeNull();
    expect(screen.queryByRole('link', { name: /admin login|restaurant owner/i })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Food Partner' })).toBeNull();
    expect(screen.getAllByRole('link', { name: 'WhatsApp' }).map((link) => link.getAttribute('href'))).toEqual(['#whatsapp-community', '#whatsapp-community']);
    for (const link of container.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
      expect(document.getElementById(decodeURIComponent(link.hash.slice(1))), `missing section for ${link.hash}`).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Next dish' }));
    expect(screen.getByRole('button', { name: 'Show Jalebi' }).getAttribute('aria-current')).toBe('true');
    expect(container.querySelector('.dish-active h4')?.textContent).toBe('Jalebi');
    fireEvent.click(screen.getByRole('button', { name: 'Previous dish' }));
    expect(container.querySelector('.dish-active h4')?.textContent).toBe('Litti Chokha');
  });

  it('places the Reel Contest after registration and before WhatsApp, and links the existing Instagram action safely', () => {
    const { container } = render(<App />);
    const registration = container.querySelector('#contest-registration');
    const reelContest = container.querySelector('#reel-contest');
    const whatsapp = container.querySelector('#whatsapp-community');
    expect(registration && reelContest && Boolean(registration.compareDocumentPosition(reelContest) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(reelContest && whatsapp && Boolean(reelContest.compareDocumentPosition(whatsapp) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    const instagramLink = container.querySelector<HTMLAnchorElement>('.share-instagram');
    expect(instagramLink?.getAttribute('href')).toBe('https://www.instagram.com/taste_of_bihar.26?mdxt=dGVrYnhkMWE2MGR1');
    expect(instagramLink?.getAttribute('target')).toBe('_blank');
    expect(instagramLink?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders the supplied social logos as minimal, accessible icon-only actions', () => {
    const { container } = render(<App />);
    const expected = [
      ['Share via WhatsApp', '/images/whatsapp-icon.png'],
      ['Open Instagram profile', '/images/instagram-icon.png'],
      ['Share this website', '/images/share-icon.png'],
    ];
    const controls = [...container.querySelectorAll<HTMLElement>('.share-actions button, .share-actions a')];
    expect(controls).toHaveLength(3);
    for (const [label, image] of expected) {
      const control = screen.getByRole(label === 'Open Instagram profile' ? 'link' : 'button', { name: label });
      expect(control.querySelector('img')?.getAttribute('src')).toBe(image);
      expect(control.textContent?.trim()).toBe('');
    }
  });

  it('renders exactly the eight requested menu dishes, prices, portions and supplied Moong Dal Halwa photo', () => {
    const { container } = render(<App />);
    const expected = [
      ['Litti Chokha', '₹50', '2 Pieces'],
      ['Jalebi', '₹50', '4 Pieces'],
      ['Rabri Jalebi', '₹60', '4 Pieces'],
      ['Aalo Pyaj Kachori', '₹30 / ₹50', '1 Piece / 2 Pieces'],
      ['Paneer Kachori', '₹40 / ₹60', '1 Piece / 2 Pieces'],
      ['Gajar Ka Halwa', '₹60', ''],
      ['Moong Dal Halwa', '₹60', ''],
      ['Kulhad Rabri', '₹50', ''],
    ];
    expect(menuItems).toHaveLength(8);
    expect(new Set(menuItems.map((item) => item.name)).size).toBe(8);
    expect(menuItems.map((item) => [item.name, item.price, item.portion])).toEqual(expected);

    const cards = [...container.querySelectorAll<HTMLElement>('.dish-card')];
    expect(cards).toHaveLength(8);
    for (const [name, price, portion] of expected) {
      const card = cards.find((candidate) => candidate.querySelector('h4')?.textContent === name);
      expect(card, `missing ${name} menu card`).toBeTruthy();
      expect(card?.querySelector('.dish-price')?.textContent).toBe(price);
      expect(card?.querySelector('.dish-heading div span')?.textContent ?? '').toBe(portion);
    }
    const littiCard = cards.find((card) => card.querySelector('h4')?.textContent === 'Litti Chokha');
    expect(littiCard?.querySelector('img')?.getAttribute('src')).toBe('/images/litti-chokha-card.png');
    const moongCard = cards.find((card) => card.querySelector('h4')?.textContent === 'Moong Dal Halwa');
    expect(moongCard?.querySelector('img')?.getAttribute('src')).toBe('/images/moong-dal-halwa.jpeg');
    expect(moongCard?.querySelector('img')?.getAttribute('alt')).toContain('moong dal halwa');
    const paneerCard = cards.find((card) => card.querySelector('h4')?.textContent === 'Paneer Kachori');
    expect(paneerCard?.querySelector('img')?.getAttribute('src')).toBe('/images/paneer-kachori.jpeg');
  });

  it('uses the revised contest tagline without a subtitle or public winner-count/selection details', () => {
    const { container } = render(<App />);
    const contest = container.querySelector<HTMLElement>('.contest-section');
    expect(screen.getByRole('heading', { name: 'A Chance to Win. A Taste to Remember.' })).toBeTruthy();
    expect(contest?.querySelector('.section-title p')).toBeNull();
    expect(contest?.textContent).not.toMatch(/five|5 free|selected manually|winner selection/i);
    expect(screen.getByLabelText('Your name')).toBeTruthy();
    expect(screen.getByLabelText('Gmail address')).toBeTruthy();
  });

  it('does not render Google sign-in or account controls', () => {
    render(<App />);
    expect(screen.queryByRole('button', { name: /sign in|google/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByLabelText(/password|phone|otp/i)).toBeNull();
  });

  it('shows the poster-style contest hero without a food photo or internal entry details', async () => {
    const { container } = render(<App />);
    const hero = container.querySelector('.hero-section');
    expect(hero).toBeTruthy();
    const heroUi = within(hero as HTMLElement);
    expect(heroUi.getByRole('heading', { name: 'Join the Lucky Draw Contest' })).toBeTruthy();
    expect(heroUi.getByRole('heading', { name: 'THE TASTE OF BIHAR' })).toBeTruthy();
    expect(heroUi.getByText('A LITTLE BIHAR AT PARIVARTAN')).toBeTruthy();
    expect(hero?.querySelector('.hero-tagline')?.textContent).toBe('Smoky Taste · Desi Flavour · Traditional Recipe');
    expect(heroUi.getByText('Register for a chance to win a plate of Litti Chokha or any one free dish at our stall.')).toBeTruthy();
    await waitFor(() => expect(hero?.querySelector('.hero-campaign-date')?.textContent).toContain('Registrations are now open!'));
    expect(hero?.querySelector('img')).toBeNull();
    expect(hero?.textContent).not.toMatch(/five winners|one free plate each|one entry per gmail/i);
    await waitFor(() => expect(heroUi.getByText(/Closes in/)).toBeTruthy());
  });

  it('shows a registration prompt with only the continue action and opens the existing form', () => {
    const { container } = render(<App />);
    const heroUi = within(container.querySelector('.hero-section') as HTMLElement);
    fireEvent.click(heroUi.getByRole('button', { name: /REGISTER NOW/i }));
    const prompt = screen.getByRole('dialog', { name: 'Ready to enter the lucky draw?' });
    expect(within(prompt).getByText('Continue to the registration form to submit your name and Gmail address.')).toBeTruthy();
    expect(within(prompt).queryByText(/WhatsApp/i)).toBeNull();
    expect(within(prompt).queryByRole('link')).toBeNull();
    expect(within(prompt).getAllByRole('button', { name: /CONTINUE TO REGISTER/i })).toHaveLength(1);
    fireEvent.click(within(prompt).getByRole('button', { name: /CONTINUE TO REGISTER/i }));
    expect(screen.queryByRole('dialog', { name: 'Ready to enter the lucky draw?' })).toBeNull();
    expect(document.getElementById('contest-registration')).toBeTruthy();
    expect(document.getElementById('contest-registration')?.scrollIntoView).toHaveBeenCalled();
    fireEvent.click(heroUi.getByRole('button', { name: /Explore Menu/i }));
    expect(document.getElementById('menu')?.scrollIntoView).toHaveBeenCalled();
  });

  it('lets visitors dismiss the registration prompt', () => {
    const { container } = render(<App />);
    const heroUi = within(container.querySelector('.hero-section') as HTMLElement);
    fireEvent.click(heroUi.getByRole('button', { name: /REGISTER NOW/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Close registration prompt' }));
    expect(screen.queryByRole('dialog', { name: 'Ready to enter the lucky draw?' })).toBeNull();
  });
});
