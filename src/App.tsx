import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ArrowRight, ArrowUp, ArrowUpRight, CalendarDays, Gift, Heart, MapPin, Menu as MenuIcon, Sparkles, Utensils, X } from 'lucide-react';
import { campaign, menuItems } from './campaign';
import { instagramProfileUrl, restaurantSponsorConfig, whatsappGroupInviteUrl } from './campaignConfig';
import { SignatureDish } from './components/SignatureDish';
import { LittiStory } from './components/LittiStory';
import { ContestRegistration } from './components/ContestRegistration';
import { ContestHeroStatus } from './components/ContestHeroStatus';
import { InstagramReelContest, isSponsorPromotionAvailable, safeWebUrl, SponsorPromotion, WhatsAppCommunity } from './components/PromotionalSections';

function App() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [eventMapOpen, setEventMapOpen] = useState(false);
  const [whatsappPromptOpen, setWhatsappPromptOpen] = useState(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!eventMapOpen && !whatsappPromptOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setEventMapOpen(false);
        setWhatsappPromptOpen(false);
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [eventMapOpen, whatsappPromptOpen]);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setMobileMenuOpen(false);
  };

  const shareMessage = `Join me at ${campaign.name} · ${campaign.event}!`;
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: campaign.name, text: shareMessage });
      else {
        try { await navigator.clipboard.writeText(shareMessage); setNotice('Invite copied. Send it to a friend!'); }
        catch { window.prompt('Copy this invite to share:', shareMessage); setNotice('Invite ready to copy.'); }
      }
    } catch { setNotice('Sharing was cancelled or is not available on this device.'); }
  };
  const shareWhatsApp = () => window.open(`https://wa.me/?text=${encodeURIComponent(shareMessage)}`, '_blank', 'noopener,noreferrer');
  const toggleFavorite = (itemName: string) => setFavorites((current) => current.includes(itemName) ? current.filter((item) => item !== itemName) : [...current, itemName]);
  const moveMenu = (direction: -1 | 1) => setMenuIndex((current) => (current + direction + menuItems.length) % menuItems.length);
  const handleSwipeStart = (event: PointerEvent<HTMLDivElement>) => { pointerStart.current = { x: event.clientX, y: event.clientY }; };
  const handleSwipeEnd = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) moveMenu(dx < 0 ? 1 : -1);
  };

  return <div className="app-shell" id="top">
    <header className="app-header">
      <a href="#top" className="header-brand" onClick={(event) => { event.preventDefault(); scrollTo('top'); }}><img className="brand-logo" src="/images/parivartan-litti-chokha-logo.png" alt="Parivartan 2K26 — Bihar Special Litti Chokha" /></a>
      <nav className={mobileMenuOpen ? 'main-nav nav-open' : 'main-nav'} aria-label="Page navigation">
        <a href="#top" onClick={() => scrollTo('top')}>Home</a><a href="#menu" onClick={() => scrollTo('menu')}>Menu</a><a href="#contest" onClick={() => scrollTo('contest')}>Contest</a><a href="#story" onClick={() => scrollTo('story')}>Our Story</a>
        {isSponsorPromotionAvailable(restaurantSponsorConfig) && <a href="#food-partner" onClick={() => scrollTo('food-partner')}>Food Partner</a>}
        {safeWebUrl(whatsappGroupInviteUrl) && <a href="#whatsapp-community" onClick={() => scrollTo('whatsapp-community')}>WhatsApp</a>}
        <a href="#location" onClick={() => scrollTo('location')}>Location</a>
      </nav>
      <div className="header-controls"><button className="mobile-menu-button" type="button" aria-expanded={mobileMenuOpen} aria-label={mobileMenuOpen ? 'Close navigation' : 'Open navigation'} onClick={() => setMobileMenuOpen((open) => !open)}>{mobileMenuOpen ? <X size={20} /> : <MenuIcon size={20} />}</button></div>
    </header>

    <main>
      <section className="hero-section page-section" id="hero">
        <div className="hero-copy"><span className="hero-kicker"><Sparkles size={14} /> A LITTLE BIHAR AT PARIVARTAN</span><h1><span>THE TASTE OF</span><strong>BIHAR</strong></h1><p className="hero-tagline">Smoky Taste <i>·</i> Desi Flavour <i>·</i> Traditional Recipe</p></div>
        <div className="hero-contest-poster">
          <h2 className="hero-contest-ribbon">Join the Lucky Draw Contest</h2>
          <div className="hero-reward-message"><Gift size={25} aria-hidden="true" /><p>Register for a chance to win a plate of Litti Chokha or any one free dish at our stall.</p></div>
          <div className="hero-campaign-date"><CalendarDays size={17} aria-hidden="true" /><span><strong>Registrations are now open!</strong></span></div>
          <ContestHeroStatus />
          <div className="hero-action-row"><button className="button button-red hero-register-button" type="button" onClick={() => setWhatsappPromptOpen(true)}>REGISTER NOW <ArrowRight size={17} /></button><button className="button button-paper hero-secondary-button" type="button" onClick={() => scrollTo('menu')}>Explore Menu <ArrowUpRight size={15} /></button></div>
        </div>
      </section>

      <section className="menu-section page-section" id="menu">
        <div className="section-title"><span className="section-kicker">✣　STRAIGHT FROM OUR STALL　✣</span><h2>Our <em>Menu</em></h2><p>Authentic Bihari Taste at Parivartan</p></div>
        <SignatureDish />
        <LittiStory />
        <div className="carousel-heading"><h3>Stall favourites</h3><span>{String(menuIndex + 1).padStart(2, '0')} <i>/</i> {String(menuItems.length).padStart(2, '0')}</span></div>
        <div className="menu-carousel" role="region" onPointerDown={handleSwipeStart} onPointerUp={handleSwipeEnd} onPointerCancel={() => { pointerStart.current = null; }} aria-roledescription="carousel" aria-label="Stall menu cards">
          {menuItems.map((item, index) => {
            let offset = index - menuIndex;
            if (offset > menuItems.length / 2) offset -= menuItems.length;
            if (offset < -menuItems.length / 2) offset += menuItems.length;
            const active = offset === 0;
            const visible = Math.abs(offset) <= 2;
            return <article key={item.name} className={`dish-card ${active ? 'dish-active' : ''} ${visible ? '' : 'dish-hidden'}`} style={{ transform: `translateX(calc(-50% + ${offset * 46}%)) scale(${active ? 1 : Math.max(.82, 1 - Math.abs(offset) * .08)}) rotate(${offset * 3}deg)`, zIndex: 10 - Math.abs(offset), opacity: visible ? Math.max(.18, 1 - Math.abs(offset) * .2) : 0, pointerEvents: visible ? 'auto' : 'none' }} aria-label={`${index + 1} of ${menuItems.length}: ${item.name}`} aria-hidden={!visible} onClick={() => { if (offset !== 0) setMenuIndex(index); }}>
              <div className={`dish-photo dish-photo-${index % 3}`}><img src={item.image ?? '/Bihar%20Special%20Litti%20Chokha%20Fest%20Banner.png'} alt={item.imageAlt ?? `Menu artwork for ${item.name}`} style={item.imagePosition ? { objectPosition: item.imagePosition } : undefined} /><span className="dish-photo-label">{active ? 'MOST LOVED' : 'FROM OUR MENU'}</span></div>
              <div className="dish-info"><div className="dish-heading"><div><h4>{item.name}</h4>{item.portion && <span>{item.portion}</span>}</div><b className={`dish-price ${item.price.includes('/') ? 'dish-price-dual' : ''}`}>{item.price}</b></div><p>{item.detail}</p><div className="dish-card-footer"><div className="dish-traits"><span><Utensils size={13} /> Fest favourite</span><span><Sparkles size={13} /> Made with care</span></div><button className={favorites.includes(item.name) ? 'favorite-button is-favorite' : 'favorite-button'} type="button" tabIndex={visible ? 0 : -1} onClick={() => toggleFavorite(item.name)} aria-pressed={favorites.includes(item.name)} aria-label={favorites.includes(item.name) ? `Remove ${item.name} from favourites` : `Add ${item.name} to favourites`}><Heart size={17} fill={favorites.includes(item.name) ? 'currentColor' : 'none'} />{favorites.includes(item.name) ? 'Saved' : 'Save'}</button></div></div>
            </article>;
          })}
          <button className="carousel-arrow carousel-prev" type="button" onClick={() => moveMenu(-1)} aria-label="Previous dish">‹</button><button className="carousel-arrow carousel-next" type="button" onClick={() => moveMenu(1)} aria-label="Next dish">›</button>
        </div>
        <div className="carousel-dots" role="group" aria-label="Choose a menu item">{menuItems.map((item, index) => <button key={item.name} type="button" className={menuIndex === index ? 'selected' : ''} aria-label={`Show ${item.name}`} aria-current={menuIndex === index ? 'true' : undefined} onClick={() => setMenuIndex(index)} />)}</div>
      </section>

      <section className="why-section page-section" id="why">
        <div className="section-title"><span className="section-kicker">A LITTLE TASTE OF HOME</span><h2>Why try our <em>Litti Chokha?</em></h2></div>
        <div className="benefit-row"><article><span className="benefit-icon leaf-icon">♧</span><h3>Traditional<br />Bihari Taste</h3></article><article><span className="benefit-icon"><Heart size={22} /></span><h3>Fresh<br />Ingredients</h3></article><article><span className="benefit-icon people-icon">♟</span><h3>Made with<br />Love</h3></article></div>
        <blockquote className="bihar-quote"><span className="quote-art" aria-hidden="true"><span className="quote-flower">✿</span><i>●</i><span className="quote-flower">✿</span></span><p>A taste of Bihar’s soul,<br /><em>right at Parivartan.</em></p><span className="quote-gamcha" aria-hidden="true" /></blockquote>
      </section>

      <section className="contest-section page-section" id="contest">
        <div className="section-title"><span className="section-kicker">PARIVARTAN 2K26 LUCKY DRAW</span><h2>A Chance to Win. <em>A Taste to Remember.</em></h2></div>
        <ContestRegistration />
        <InstagramReelContest />
        <WhatsAppCommunity />
      </section>

      <SponsorPromotion />

      <section className="location-section page-section" id="location">
        <div className="section-title"><span className="section-kicker">COME SAY NAMASTE</span><h2>Find our <em>stall</em></h2><p>{campaign.event}</p></div>
        <div className="location-card"><div className="location-details"><span className="location-pin"><MapPin size={25} /></span><div><span className="section-eyebrow">WE’RE SETTING UP AT</span><h3>Stall No. {campaign.stallNumber}</h3><p>{campaign.stallLocation}</p></div></div><div className="map-preview" id="event-map"><img src="/images/cgc-campus-map.png" alt="Parivartan campus map showing our stall near Chandigarh College of Engineering Block-11 and the food court" /></div><button className="button button-paper map-view-button" type="button" onClick={() => setEventMapOpen(true)}><MapPin size={16} /> View Event Map</button></div>
      </section>

      <section className="about-section page-section" id="about"><div className="about-copy"><span className="section-kicker">A LITTLE ABOUT OUR STALL</span><h2>Bringing Bihar<br /><em>to Parivartan.</em></h2><p>Enjoy traditional Litti Chokha and a range of delicious Bihari snacks, made with love and genuine flavours.</p></div><div className="about-art" aria-hidden="true"><span className="about-sun" /><span className="about-house">⌂</span><span className="about-tree tree-one">♧</span><span className="about-tree tree-two">♧</span><div className="about-landscape">⌂　♧　♟　♧　⌂</div></div></section>

      <section className="share-section page-section" id="share"><div className="share-decoration" aria-hidden="true">✿　✳　✿</div><span className="section-kicker">SPREAD A LITTLE JOY</span><h2>Share the <em>Goodness</em></h2><p>Invite your friends to visit our stall and join the lucky draw.</p><div className="share-actions"><button className="share-whatsapp" type="button" aria-label="Share via WhatsApp" title="Share via WhatsApp" onClick={shareWhatsApp}><img className="share-action-icon" src="/images/whatsapp-icon.png" alt="" /></button><a className="share-instagram" href={instagramProfileUrl} target="_blank" rel="noopener noreferrer" aria-label="Open Instagram profile" title="Instagram"><img className="share-action-icon" src="/images/instagram-icon.png" alt="" /></a><button className="share-general" type="button" aria-label="Share this website" title="Share this website" onClick={share}><img className="share-action-icon" src="/images/share-icon.png" alt="" /></button></div></section>

      <footer className="campaign-footer"><div className="footer-brand"><img className="footer-logo" src="/images/parivartan-litti-chokha-logo.png" alt="Parivartan 2K26 — Bihar Special Litti Chokha" /></div><nav aria-label="Footer quick links"><a href="#menu">Menu</a><a href="#contest">Contest</a><a href="#story">Our Story</a>{isSponsorPromotionAvailable(restaurantSponsorConfig) && <a href="#food-partner">Food Partner</a>}<a href="#location">Location</a>{safeWebUrl(whatsappGroupInviteUrl) && <a href="#whatsapp-community">WhatsApp</a>}</nav><button type="button" className="back-to-top" onClick={() => scrollTo('top')} aria-label="Back to top"><ArrowUp size={20} /></button><div className="footer-frieze" aria-hidden="true">✿　◇　✿　◇　✿　◇　✿　◇　✿</div></footer>
    </main>
    {eventMapOpen && <div className="event-map-lightbox" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEventMapOpen(false); }}><section className="event-map-dialog" role="dialog" aria-modal="true" aria-labelledby="event-map-title"><div className="event-map-dialog-heading"><h2 id="event-map-title">Parivartan 2K26 Campus Map</h2><button type="button" onClick={() => setEventMapOpen(false)} aria-label="Close event map"><X size={21} /></button></div><img src="/images/cgc-campus-map.png" alt="Campus map with our stall marked near Chandigarh College of Engineering Block-11 and the food court" /></section></div>}
    {whatsappPromptOpen && <div className="registration-prompt-lightbox" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setWhatsappPromptOpen(false); }}><section className="registration-prompt-dialog" role="dialog" aria-modal="true" aria-labelledby="registration-prompt-title"><button className="registration-prompt-close" type="button" onClick={() => setWhatsappPromptOpen(false)} aria-label="Close registration prompt"><X size={19} /></button><h2 id="registration-prompt-title">Ready to enter the lucky draw?</h2><p>Continue to the registration form to submit your name and Gmail address.</p><div className="registration-prompt-actions"><button className="button button-red" type="button" onClick={() => { setWhatsappPromptOpen(false); scrollTo('contest-registration'); }}>CONTINUE TO REGISTER <ArrowRight size={16} /></button></div></section></div>}
    {notice && <div className="toast" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Dismiss notification"><X size={16} /></button></div>}
  </div>;
}

export default App;
