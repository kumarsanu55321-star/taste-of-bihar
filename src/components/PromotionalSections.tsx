import { useState } from 'react';
import { ArrowUpRight, MessageCircle, Utensils } from 'lucide-react';
import { instagramProfileUrl, restaurantSponsorConfig, type RestaurantSponsorConfig, whatsappGroupInviteUrl } from '../campaignConfig';

export function safeWebUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeImageSource(value: string): string | null {
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  return safeWebUrl(value);
}

export function isSponsorPromotionAvailable(config: RestaurantSponsorConfig = restaurantSponsorConfig) {
  return config.enabled && Boolean(config.name.trim() && config.description.trim());
}

export function WhatsAppCommunity({ inviteUrl = whatsappGroupInviteUrl }: { inviteUrl?: string }) {
  const safeInviteUrl = safeWebUrl(inviteUrl);

  return <section className="whatsapp-community" id="whatsapp-community" aria-labelledby="whatsapp-community-title">
    <MessageCircle size={25} aria-hidden="true" />
    <div className="whatsapp-community-copy">
      <h3 id="whatsapp-community-title">JOIN OUR WHATSAPP GROUP TO SEE THE RESULTS</h3>
      <p>Want to know who wins? Join our official Parivartan 2K26 WhatsApp group! We'll announce the lucky winners there after registrations close.</p>
    </div>
    {safeInviteUrl
      ? <a href={safeInviteUrl} target="_blank" rel="noopener noreferrer" className="button button-green">JOIN WHATSAPP GROUP <ArrowUpRight size={15} /></a>
      : <button type="button" className="button button-muted" disabled title="The official invitation link has not been configured">JOIN WHATSAPP GROUP</button>}
  </section>;
}

export function InstagramReelContest({ profileUrl = instagramProfileUrl }: { profileUrl?: string }) {
  const safeProfileUrl = safeWebUrl(profileUrl);

  return <section className="instagram-reel-contest" id="reel-contest" aria-labelledby="reel-contest-title">
    <div className="reel-contest-visual">
      <img src="/images/instagram-film-festival-banner.png" alt="Instagram film festival artwork with a colorful Instagram camera and film strips" />
    </div>
    <div className="reel-contest-copy">
      <span className="reel-contest-kicker">A LITTLE FESTIVAL CREATIVITY</span>
      <h2 id="reel-contest-title">MAKE REELS. TAG US. <em>WIN FREE FOOD!</em></h2>
      <h3>Show us your creativity and celebrate the taste of Bihar!</h3>
      <p>Create an Instagram Reel featuring our stall, Litti Chokha, food, or your experience at Parivartan 2K26. Post it on Instagram and tag our official account @taste_of_bihar.26.</p>
      <div className="reel-prize-banner"><span aria-hidden="true">🏆</span> THE BEST REEL WINS A <strong>FREE PLATTER!</strong></div>
      {safeProfileUrl
        ? <a className="button button-green reel-contest-cta" href={safeProfileUrl} target="_blank" rel="noopener noreferrer">CREATE YOUR REEL <ArrowUpRight size={17} /></a>
        : <button className="button button-muted reel-contest-cta" type="button" disabled>CREATE YOUR REEL</button>}
    </div>
  </section>;
}

export function SponsorPromotion({ config = restaurantSponsorConfig }: { config?: RestaurantSponsorConfig }) {
  const [imageFailed, setImageFailed] = useState(false);
  if (!isSponsorPromotionAvailable(config)) return null;

  const imageSource = !imageFailed && config.image.trim() ? safeImageSource(config.image.trim()) : null;
  const website = config.website.trim() ? safeWebUrl(config.website.trim()) : null;

  return <section className="sponsor-promotion page-section" id="food-partner" aria-labelledby="sponsor-promotion-title">
    <div className="sponsor-promotion-inner">
      <span className="section-kicker">A PARTNER IN GOOD TASTE</span>
      <h2 id="sponsor-promotion-title">OUR <em>FOOD PARTNER</em></h2>
      {imageSource ? <img className="sponsor-promotion-image" src={imageSource} alt={`${config.name} promotional image`} loading="lazy" onError={() => setImageFailed(true)} /> : <span className="sponsor-image-fallback" aria-label={`${config.name} logo unavailable`}>{config.name.trim().slice(0, 1).toUpperCase()}</span>}
      <h3>{config.name}</h3>
      <p>{config.description}</p>
      {config.offerMessage.trim() && <p className="sponsor-offer-message">{config.offerMessage}</p>}
      {website && <a className="button button-paper sponsor-website-link" href={website} target="_blank" rel="noopener noreferrer">Visit official website <ArrowUpRight size={15} /></a>}
      <small>Any approved offer is distributed physically at our stall. No digital coupons are issued.</small>
      <Utensils className="sponsor-promotion-flourish" size={17} aria-hidden="true" />
    </div>
  </section>;
}
