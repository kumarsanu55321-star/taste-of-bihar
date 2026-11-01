/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { InstagramReelContest, SponsorPromotion, WhatsAppCommunity } from './PromotionalSections';
import type { RestaurantSponsorConfig } from '../campaignConfig';

afterEach(cleanup);

describe('promotional sections', () => {
  it('renders the Reel Contest content and safely links its call to action to the official Instagram profile', () => {
    render(<InstagramReelContest />);
    expect(screen.getByRole('heading', { name: 'MAKE REELS. TAG US. WIN FREE FOOD!' })).toBeTruthy();
    expect(screen.getByText('Show us your creativity and celebrate the taste of Bihar!')).toBeTruthy();
    expect(screen.getByText('Create an Instagram Reel featuring our stall, Litti Chokha, food, or your experience at Parivartan 2K26. Post it on Instagram and tag our official account @taste_of_bihar.26.')).toBeTruthy();
    expect(document.querySelector('.reel-prize-banner')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('🏆 THE BEST REEL WINS A FREE PLATTER!');
    expect(screen.getByRole('img', { name: 'Instagram film festival artwork with a colorful Instagram camera and film strips' }).getAttribute('src')).toBe('/images/instagram-film-festival-banner.png');
    const link = screen.getByRole('link', { name: /CREATE YOUR REEL/i });
    expect(link.getAttribute('href')).toBe('https://www.instagram.com/taste_of_bihar.26?mdxt=dGVrYnhkMWE2MGR1');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('does not create an unsafe Instagram link from an invalid URL', () => {
    render(<InstagramReelContest profileUrl="javascript:alert(1)" />);
    expect(screen.queryByRole('link', { name: /CREATE YOUR REEL/i })).toBeNull();
    expect((screen.getByRole('button', { name: /CREATE YOUR REEL/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the WhatsApp button disabled until an official invitation URL is configured', () => {
    render(<WhatsAppCommunity inviteUrl="" />);
    expect(screen.getByRole('heading', { name: 'JOIN OUR WHATSAPP GROUP TO SEE THE RESULTS' })).toBeTruthy();
    expect(screen.getByText("Want to know who wins? Join our official Parivartan 2K26 WhatsApp group! We'll announce the lucky winners there after registrations close.")).toBeTruthy();
    expect(screen.queryByText('Joining the group is optional and does not register you for the contest.')).toBeNull();
    expect((screen.getByRole('button', { name: 'JOIN WHATSAPP GROUP' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens a configured WhatsApp invitation safely in a new tab', () => {
    render(<WhatsAppCommunity inviteUrl="https://chat.whatsapp.com/example-invite" />);
    const link = screen.getByRole('link', { name: /JOIN WHATSAPP GROUP/i });
    expect(link.getAttribute('href')).toBe('https://chat.whatsapp.com/example-invite');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('does not render an unconfirmed sponsor by default', () => {
    const { container } = render(<SponsorPromotion config={{ enabled: false, name: '', image: '', description: '', website: '', offerMessage: '' }} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders only configured sponsor information and safely handles its website', () => {
    const config: RestaurantSponsorConfig = {
      enabled: true,
      name: 'Test Food Partner',
      image: '/images/partner-logo.png',
      description: 'A configured partner description.',
      website: 'https://partner.example',
      offerMessage: 'Approved offer message.',
    };
    const { container } = render(<SponsorPromotion config={config} />);
    expect(screen.getByRole('heading', { name: 'OUR FOOD PARTNER' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Test Food Partner' })).toBeTruthy();
    expect(screen.getByText('Approved offer message.')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Test Food Partner promotional image' }).getAttribute('src')).toBe('/images/partner-logo.png');
    const link = screen.getByRole('link', { name: 'Visit official website' });
    expect(link.getAttribute('href')).toBe('https://partner.example/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    const sponsorImage = screen.getByRole('img', { name: 'Test Food Partner promotional image' });
    fireEvent.error(sponsorImage);
    expect(container.querySelector('.sponsor-image-fallback')?.textContent).toBe('T');
  });

  it('does not create unsafe external links from configuration', () => {
    const config: RestaurantSponsorConfig = {
      enabled: true,
      name: 'Configured Partner',
      image: 'javascript:alert(1)',
      description: 'Configured description.',
      website: 'javascript:alert(1)',
      offerMessage: '',
    };
    const { container } = render(<SponsorPromotion config={config} />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});
