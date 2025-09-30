import { ContentType } from '../../models/interaction';

export interface MockFeedItem {
  id: string;
  title: string;
  description?: string;
  contentType: ContentType;
  startTime?: string;
  endTime?: string;
  tags: string[];
  embedding: number[];
  createdAt: Date;
  stats: {
    views: number;
    likes: number;
    shares: number;
    bookmarks: number;
  };
  source: {
    sourceId: string;
    sourceEventId: string;
    sourceUrl?: string;
  };
}

// Generate a random normalized embedding vector
function generateMockEmbedding(seed: number): number[] {
  const vector: number[] = [];
  for (let i = 0; i < 1536; i++) {
    // Use seed to make it deterministic but varied
    vector.push((Math.sin(seed * i * 0.1) + Math.cos(seed * i * 0.05)) / 2);
  }
  // Normalize
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  return vector.map(val => val / magnitude);
}

// Helper to create dates relative to today
function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(10, 0, 0, 0);
  return date;
}

function hoursFromNow(hours: number): Date {
  const date = new Date();
  date.setHours(date.getHours() + hours);
  return date;
}

export const MOCK_CONTENT: MockFeedItem[] = [
  // EVENTS - Fitness & Wellness
  {
    id: 'mock-event-1',
    title: 'Community Yoga in the Park',
    description: 'Free outdoor yoga session for all skill levels. Bring your own mat!',
    contentType: 'event',
    startTime: daysFromNow(1).toISOString(),
    endTime: new Date(daysFromNow(1).getTime() + 60 * 60 * 1000).toISOString(),
    tags: ['yoga', 'wellness', 'outdoors', 'free', 'fitness'],
    embedding: generateMockEmbedding(1),
    createdAt: daysFromNow(-2),
    stats: { views: 45, likes: 12, shares: 3, bookmarks: 8 },
    source: { sourceId: 'mock', sourceEventId: 'evt-1' },
  },
  {
    id: 'mock-event-2',
    title: 'Beginner Running Group',
    description: 'Weekly running group meets every Saturday morning. Couch to 5K program.',
    contentType: 'event',
    startTime: daysFromNow(3).toISOString(),
    endTime: new Date(daysFromNow(3).getTime() + 90 * 60 * 1000).toISOString(),
    tags: ['running', 'fitness', 'sports', 'beginner', 'community'],
    embedding: generateMockEmbedding(2),
    createdAt: daysFromNow(-1),
    stats: { views: 32, likes: 8, shares: 2, bookmarks: 5 },
    source: { sourceId: 'mock', sourceEventId: 'evt-2' },
  },
  {
    id: 'mock-event-3',
    title: 'Meditation & Mindfulness Workshop',
    description: 'Learn practical meditation techniques. Suitable for beginners.',
    contentType: 'event',
    startTime: daysFromNow(5).toISOString(),
    endTime: new Date(daysFromNow(5).getTime() + 120 * 60 * 1000).toISOString(),
    tags: ['meditation', 'wellness', 'mindfulness', 'workshop', 'mental-health'],
    embedding: generateMockEmbedding(3),
    createdAt: daysFromNow(-3),
    stats: { views: 28, likes: 9, shares: 1, bookmarks: 6 },
    source: { sourceId: 'mock', sourceEventId: 'evt-3' },
  },

  // EVENTS - Food & Culinary
  {
    id: 'mock-event-4',
    title: 'Weekend Farmers Market',
    description: 'Fresh local produce, artisan goods, and live music.',
    contentType: 'event',
    startTime: daysFromNow(2).toISOString(),
    endTime: new Date(daysFromNow(2).getTime() + 240 * 60 * 1000).toISOString(),
    tags: ['food', 'farmers-market', 'local', 'shopping', 'community'],
    embedding: generateMockEmbedding(4),
    createdAt: daysFromNow(-4),
    stats: { views: 67, likes: 18, shares: 5, bookmarks: 12 },
    source: { sourceId: 'mock', sourceEventId: 'evt-4' },
  },
  {
    id: 'mock-event-5',
    title: 'Italian Cooking Class',
    description: 'Learn to make fresh pasta and classic sauces. All ingredients provided.',
    contentType: 'event',
    startTime: daysFromNow(7).toISOString(),
    endTime: new Date(daysFromNow(7).getTime() + 180 * 60 * 1000).toISOString(),
    tags: ['cooking', 'food', 'workshop', 'italian', 'culinary'],
    embedding: generateMockEmbedding(5),
    createdAt: daysFromNow(-1),
    stats: { views: 41, likes: 15, shares: 4, bookmarks: 10 },
    source: { sourceId: 'mock', sourceEventId: 'evt-5' },
  },
  {
    id: 'mock-event-6',
    title: 'Coffee Tasting Event',
    description: 'Sample beans from around the world with a master roaster.',
    contentType: 'event',
    startTime: daysFromNow(4).toISOString(),
    endTime: new Date(daysFromNow(4).getTime() + 90 * 60 * 1000).toISOString(),
    tags: ['coffee', 'food', 'tasting', 'culinary', 'education'],
    embedding: generateMockEmbedding(6),
    createdAt: daysFromNow(-2),
    stats: { views: 35, likes: 11, shares: 3, bookmarks: 7 },
    source: { sourceId: 'mock', sourceEventId: 'evt-6' },
  },

  // EVENTS - Arts & Culture
  {
    id: 'mock-event-7',
    title: 'Live Jazz Night',
    description: 'Local jazz quartet performing classic standards and original compositions.',
    contentType: 'event',
    startTime: daysFromNow(6).toISOString(),
    endTime: new Date(daysFromNow(6).getTime() + 150 * 60 * 1000).toISOString(),
    tags: ['music', 'jazz', 'live-music', 'arts', 'entertainment'],
    embedding: generateMockEmbedding(7),
    createdAt: daysFromNow(-5),
    stats: { views: 53, likes: 19, shares: 6, bookmarks: 11 },
    source: { sourceId: 'mock', sourceEventId: 'evt-7' },
  },
  {
    id: 'mock-event-8',
    title: 'Community Theater: A Midsummer Night\'s Dream',
    description: 'Local theater company presents Shakespeare in the park.',
    contentType: 'event',
    startTime: daysFromNow(10).toISOString(),
    endTime: new Date(daysFromNow(10).getTime() + 120 * 60 * 1000).toISOString(),
    tags: ['theater', 'arts', 'performance', 'shakespeare', 'culture'],
    embedding: generateMockEmbedding(8),
    createdAt: daysFromNow(-3),
    stats: { views: 48, likes: 14, shares: 4, bookmarks: 9 },
    source: { sourceId: 'mock', sourceEventId: 'evt-8' },
  },
  {
    id: 'mock-event-9',
    title: 'Art Gallery Opening: Local Artists',
    description: 'Opening reception for new exhibit featuring 12 local artists.',
    contentType: 'event',
    startTime: daysFromNow(8).toISOString(),
    endTime: new Date(daysFromNow(8).getTime() + 180 * 60 * 1000).toISOString(),
    tags: ['art', 'gallery', 'arts', 'culture', 'local'],
    embedding: generateMockEmbedding(9),
    createdAt: daysFromNow(-6),
    stats: { views: 39, likes: 13, shares: 3, bookmarks: 8 },
    source: { sourceId: 'mock', sourceEventId: 'evt-9' },
  },

  // EVENTS - Family & Kids
  {
    id: 'mock-event-10',
    title: 'Family Movie Night in the Park',
    description: 'Free outdoor screening of a family-friendly classic. Bring blankets!',
    contentType: 'event',
    startTime: daysFromNow(5).toISOString(),
    endTime: new Date(daysFromNow(5).getTime() + 120 * 60 * 1000).toISOString(),
    tags: ['family', 'kids', 'movie', 'free', 'entertainment'],
    embedding: generateMockEmbedding(10),
    createdAt: daysFromNow(-4),
    stats: { views: 78, likes: 24, shares: 8, bookmarks: 15 },
    source: { sourceId: 'mock', sourceEventId: 'evt-10' },
  },
  {
    id: 'mock-event-11',
    title: 'Kids Art & Crafts Workshop',
    description: 'Creative activities for ages 5-12. All materials included.',
    contentType: 'event',
    startTime: daysFromNow(9).toISOString(),
    endTime: new Date(daysFromNow(9).getTime() + 90 * 60 * 1000).toISOString(),
    tags: ['kids', 'family', 'art', 'workshop', 'education'],
    embedding: generateMockEmbedding(11),
    createdAt: daysFromNow(-2),
    stats: { views: 52, likes: 17, shares: 5, bookmarks: 11 },
    source: { sourceId: 'mock', sourceEventId: 'evt-11' },
  },
  {
    id: 'mock-event-12',
    title: 'Parent-Child Soccer Clinic',
    description: 'Fun soccer skills for kids ages 6-10 with parent participation.',
    contentType: 'event',
    startTime: daysFromNow(12).toISOString(),
    endTime: new Date(daysFromNow(12).getTime() + 90 * 60 * 1000).toISOString(),
    tags: ['kids', 'family', 'soccer', 'sports', 'education'],
    embedding: generateMockEmbedding(12),
    createdAt: daysFromNow(-1),
    stats: { views: 44, likes: 13, shares: 4, bookmarks: 8 },
    source: { sourceId: 'mock', sourceEventId: 'evt-12' },
  },

  // FLASH OFFERS - Time-Sensitive Deals
  {
    id: 'mock-offer-1',
    title: '50% Off First Month Gym Membership',
    description: 'New members only. Offer expires in 48 hours!',
    contentType: 'flash-offer',
    startTime: hoursFromNow(2).toISOString(),
    endTime: hoursFromNow(50).toISOString(),
    tags: ['fitness', 'deals', 'gym', 'discount', 'time-sensitive'],
    embedding: generateMockEmbedding(13),
    createdAt: hoursFromNow(-1),
    stats: { views: 112, likes: 34, shares: 12, bookmarks: 28 },
    source: { sourceId: 'mock', sourceEventId: 'offer-1' },
  },
  {
    id: 'mock-offer-2',
    title: 'Buy One Get One Free Pizza Night',
    description: 'Tonight only! Dine-in or takeout. Show this post.',
    contentType: 'flash-offer',
    startTime: hoursFromNow(4).toISOString(),
    endTime: hoursFromNow(8).toISOString(),
    tags: ['food', 'deals', 'restaurant', 'discount', 'time-sensitive'],
    embedding: generateMockEmbedding(14),
    createdAt: hoursFromNow(-2),
    stats: { views: 156, likes: 47, shares: 19, bookmarks: 35 },
    source: { sourceId: 'mock', sourceEventId: 'offer-2' },
  },
  {
    id: 'mock-offer-3',
    title: 'Last-Minute Concert Tickets - $20 Off',
    description: 'Limited seats available for tonight\'s show. Use code COMMUNITY20.',
    contentType: 'flash-offer',
    startTime: hoursFromNow(1).toISOString(),
    endTime: hoursFromNow(6).toISOString(),
    tags: ['music', 'deals', 'concert', 'discount', 'time-sensitive'],
    embedding: generateMockEmbedding(15),
    createdAt: hoursFromNow(-1),
    stats: { views: 89, likes: 26, shares: 8, bookmarks: 18 },
    source: { sourceId: 'mock', sourceEventId: 'offer-3' },
  },
  {
    id: 'mock-offer-4',
    title: 'Early Bird Yoga Class - Half Price',
    description: 'Tomorrow\'s 6am class only. First 10 to sign up.',
    contentType: 'flash-offer',
    startTime: hoursFromNow(12).toISOString(),
    endTime: hoursFromNow(18).toISOString(),
    tags: ['yoga', 'deals', 'fitness', 'discount', 'wellness'],
    embedding: generateMockEmbedding(16),
    createdAt: hoursFromNow(-3),
    stats: { views: 64, likes: 21, shares: 5, bookmarks: 14 },
    source: { sourceId: 'mock', sourceEventId: 'offer-4' },
  },

  // POLLS - Community Feedback
  {
    id: 'mock-poll-1',
    title: 'What new class should we add to the community center?',
    description: 'Vote for your top choice! Ceramics, Photography, or Cooking?',
    contentType: 'poll',
    tags: ['community', 'poll', 'vote', 'education', 'feedback'],
    embedding: generateMockEmbedding(17),
    createdAt: daysFromNow(-1),
    stats: { views: 92, likes: 38, shares: 7, bookmarks: 12 },
    source: { sourceId: 'mock', sourceEventId: 'poll-1' },
  },
  {
    id: 'mock-poll-2',
    title: 'Best time for weekend farmers market?',
    description: 'Help us pick: Saturday morning, Saturday afternoon, or Sunday morning?',
    contentType: 'poll',
    tags: ['community', 'poll', 'vote', 'farmers-market', 'feedback'],
    embedding: generateMockEmbedding(18),
    createdAt: daysFromNow(-3),
    stats: { views: 78, likes: 29, shares: 6, bookmarks: 9 },
    source: { sourceId: 'mock', sourceEventId: 'poll-2' },
  },
  {
    id: 'mock-poll-3',
    title: 'Which outdoor concert genre would you attend?',
    description: 'Jazz, Rock, Classical, or Folk? Let us know!',
    contentType: 'poll',
    tags: ['music', 'poll', 'vote', 'community', 'feedback'],
    embedding: generateMockEmbedding(19),
    createdAt: daysFromNow(-2),
    stats: { views: 85, likes: 34, shares: 8, bookmarks: 11 },
    source: { sourceId: 'mock', sourceEventId: 'poll-3' },
  },

  // REQUESTS - Community Help
  {
    id: 'mock-request-1',
    title: 'Volunteer Needed: Community Garden Setup',
    description: 'Looking for 5-6 volunteers to help build raised beds this Saturday.',
    contentType: 'request',
    tags: ['volunteer', 'community', 'gardening', 'help-needed', 'outdoors'],
    embedding: generateMockEmbedding(20),
    createdAt: daysFromNow(-1),
    stats: { views: 56, likes: 18, shares: 9, bookmarks: 14 },
    source: { sourceId: 'mock', sourceEventId: 'req-1' },
  },
  {
    id: 'mock-request-2',
    title: 'Seeking: Kids Soccer Coach',
    description: 'Youth league needs assistant coach for ages 8-10. Weeknight practices.',
    contentType: 'request',
    tags: ['volunteer', 'kids', 'soccer', 'sports', 'help-needed'],
    embedding: generateMockEmbedding(21),
    createdAt: daysFromNow(-2),
    stats: { views: 43, likes: 12, shares: 6, bookmarks: 9 },
    source: { sourceId: 'mock', sourceEventId: 'req-2' },
  },
  {
    id: 'mock-request-3',
    title: 'Donations Wanted: Local Food Bank Drive',
    description: 'Accepting non-perishable items all week. Drop-off at community center.',
    contentType: 'request',
    tags: ['volunteer', 'community', 'food', 'charity', 'help-needed'],
    embedding: generateMockEmbedding(22),
    createdAt: daysFromNow(-4),
    stats: { views: 71, likes: 24, shares: 11, bookmarks: 16 },
    source: { sourceId: 'mock', sourceEventId: 'req-3' },
  },

  // ANNOUNCEMENTS - Community Updates
  {
    id: 'mock-announce-1',
    title: 'New Bike Lane Opening Next Week',
    description: 'Main Street bike lane complete! Grand opening ceremony Monday 9am.',
    contentType: 'announcement',
    tags: ['community', 'cycling', 'infrastructure', 'news', 'local'],
    embedding: generateMockEmbedding(23),
    createdAt: daysFromNow(-2),
    stats: { views: 134, likes: 42, shares: 15, bookmarks: 22 },
    source: { sourceId: 'mock', sourceEventId: 'announce-1' },
  },
  {
    id: 'mock-announce-2',
    title: 'Community Center WiFi Upgrade Complete',
    description: 'Free high-speed internet now available in all rooms!',
    contentType: 'announcement',
    tags: ['community', 'technology', 'news', 'update', 'local'],
    embedding: generateMockEmbedding(24),
    createdAt: daysFromNow(-1),
    stats: { views: 98, likes: 31, shares: 8, bookmarks: 14 },
    source: { sourceId: 'mock', sourceEventId: 'announce-2' },
  },

  // Additional diverse events
  {
    id: 'mock-event-13',
    title: 'Dog Training 101',
    description: 'Basic obedience training for puppies and adult dogs. Bring your pup!',
    contentType: 'event',
    startTime: daysFromNow(11).toISOString(),
    endTime: new Date(daysFromNow(11).getTime() + 90 * 60 * 1000).toISOString(),
    tags: ['pets', 'dogs', 'training', 'education', 'outdoors'],
    embedding: generateMockEmbedding(25),
    createdAt: daysFromNow(-3),
    stats: { views: 37, likes: 14, shares: 4, bookmarks: 9 },
    source: { sourceId: 'mock', sourceEventId: 'evt-13' },
  },
  {
    id: 'mock-event-14',
    title: 'Book Club: Mystery Night',
    description: 'Monthly book club discussing this month\'s mystery novel. New members welcome!',
    contentType: 'event',
    startTime: daysFromNow(14).toISOString(),
    endTime: new Date(daysFromNow(14).getTime() + 120 * 60 * 1000).toISOString(),
    tags: ['books', 'reading', 'culture', 'social', 'education'],
    embedding: generateMockEmbedding(26),
    createdAt: daysFromNow(-5),
    stats: { views: 42, likes: 16, shares: 3, bookmarks: 11 },
    source: { sourceId: 'mock', sourceEventId: 'evt-14' },
  },
  {
    id: 'mock-event-15',
    title: 'Photography Walk: Golden Hour',
    description: 'Sunset photography walk through historic district. All skill levels.',
    contentType: 'event',
    startTime: daysFromNow(13).toISOString(),
    endTime: new Date(daysFromNow(13).getTime() + 90 * 60 * 1000).toISOString(),
    tags: ['photography', 'arts', 'outdoors', 'walking', 'education'],
    embedding: generateMockEmbedding(27),
    createdAt: daysFromNow(-2),
    stats: { views: 49, likes: 18, shares: 5, bookmarks: 12 },
    source: { sourceId: 'mock', sourceEventId: 'evt-15' },
  },
  {
    id: 'mock-event-16',
    title: 'Trivia Night at Local Brewery',
    description: 'Weekly trivia competition. Teams of 4-6. Prizes for top 3 teams!',
    contentType: 'event',
    startTime: daysFromNow(4).toISOString(),
    endTime: new Date(daysFromNow(4).getTime() + 150 * 60 * 1000).toISOString(),
    tags: ['trivia', 'social', 'entertainment', 'beer', 'games'],
    embedding: generateMockEmbedding(28),
    createdAt: daysFromNow(-6),
    stats: { views: 67, likes: 23, shares: 7, bookmarks: 15 },
    source: { sourceId: 'mock', sourceEventId: 'evt-16' },
  },
  {
    id: 'mock-event-17',
    title: 'Sustainable Living Workshop',
    description: 'Learn composting, zero-waste living, and urban gardening techniques.',
    contentType: 'event',
    startTime: daysFromNow(15).toISOString(),
    endTime: new Date(daysFromNow(15).getTime() + 120 * 60 * 1000).toISOString(),
    tags: ['sustainability', 'environment', 'workshop', 'education', 'gardening'],
    embedding: generateMockEmbedding(29),
    createdAt: daysFromNow(-4),
    stats: { views: 54, likes: 19, shares: 6, bookmarks: 13 },
    source: { sourceId: 'mock', sourceEventId: 'evt-17' },
  },
];
