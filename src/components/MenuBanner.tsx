import { useState } from 'react';

export const bannerPath = '/Bihar%20Special%20Litti%20Chokha%20Fest%20Banner.png';
const menuPhotoPath = '/images/litti-chokha-feast.jpg';

export function MenuBanner() {
  const [loaded, setLoaded] = useState(true);

  return <div className="banner-art-frame">
    {loaded
      ? <img className="menu-banner-art" src={menuPhotoPath} alt="A platter of smoky Litti Chokha served with roasted chokha and chutney" onError={() => setLoaded(false)} />
      : <span className="banner-empty"><b>Litti Chokha feast</b><small>Add the supplied food photo to public/images/litti-chokha-feast.jpg.</small></span>}
  </div>;
}
