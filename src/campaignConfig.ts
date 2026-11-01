export const whatsappGroupInviteUrl = 'https://chat.whatsapp.com/KIFy7dhkxsI72U7RXbrR8x';
export const instagramProfileUrl = 'https://www.instagram.com/taste_of_bihar.26?mdxt=dGVrYnhkMWE2MGR1';

export type RestaurantSponsorConfig = {
  enabled: boolean;
  name: string;
  image: string;
  description: string;
  website: string;
  offerMessage: string;
};

// Keep disabled and blank until the restaurant partnership is confirmed.
export const restaurantSponsorConfig: RestaurantSponsorConfig = {
  enabled: false,
  name: '',
  image: '',
  description: '',
  website: '',
  offerMessage: '',
};

export const contestSchedule = {
  end: new Date('2026-11-04T18:00:00+05:30'),
};
