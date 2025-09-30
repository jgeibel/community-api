import { UserProfile } from '../../services/userProfileService';

// Generate a normalized vector biased toward certain dimensions
function generateBiasedEmbedding(biases: Record<number, number>): number[] {
  const vector: number[] = [];
  for (let i = 0; i < 1536; i++) {
    // Base random value
    let value = (Math.random() - 0.5) * 0.5;

    // Apply biases for specific dimensions
    if (biases[i]) {
      value += biases[i];
    }

    vector.push(value);
  }

  // Normalize
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  return vector.map(val => val / magnitude);
}

export interface MockPersona {
  userId: string;
  profile: UserProfile;
  description: string;
}

// Mock personas with distinct preferences
export const MOCK_PERSONAS: Map<string, MockPersona> = new Map([
  [
    'mock-foodie',
    {
      userId: 'mock-foodie',
      description: 'Loves food, restaurants, cooking, and culinary experiences',
      profile: {
        userId: 'mock-foodie',
        embedding: generateBiasedEmbedding({
          // Bias toward food-related dimensions
          100: 0.8, 150: 0.7, 200: 0.6, 250: 0.5,
          300: 0.7, 350: 0.6, 400: 0.5,
        }),
        contentTypeAffinity: {
          event: 0.6,
          'flash-offer': 0.9,  // Loves food deals!
          poll: 0.3,
          request: 0.2,
          announcement: 0.1,
          photo: 0.4,
        },
        timeOfDayPatterns: {
          morning: 15,
          afternoon: 25,
          evening: 40,  // Most active during dinner time
          night: 20,
        },
        engagementStyle: {
          isDeepReader: true,
          scrollsDeep: true,
          quickBrowser: false,
          avgDwellTime: 12.5,
          avgPosition: 25,
        },
        totalInteractions: 150,
        lastActiveAt: new Date().toISOString(),
      },
    },
  ],
  [
    'mock-parent',
    {
      userId: 'mock-parent',
      description: 'Focused on family activities, kids events, and education',
      profile: {
        userId: 'mock-parent',
        embedding: generateBiasedEmbedding({
          // Bias toward family/kids/education dimensions
          50: 0.9, 125: 0.8, 175: 0.7, 225: 0.6,
          275: 0.7, 325: 0.6, 375: 0.5,
        }),
        contentTypeAffinity: {
          event: 0.9,  // Loves family events
          'flash-offer': 0.5,
          poll: 0.6,  // Wants to provide input
          request: 0.7,  // Community-minded
          announcement: 0.5,
          photo: 0.3,
        },
        timeOfDayPatterns: {
          morning: 30,  // Active during school drop-off
          afternoon: 35,  // Planning after-school activities
          evening: 25,
          night: 10,
        },
        engagementStyle: {
          isDeepReader: false,
          scrollsDeep: false,
          quickBrowser: true,  // Busy parent, quick scrolling
          avgDwellTime: 4.2,
          avgPosition: 12,
        },
        totalInteractions: 200,
        lastActiveAt: new Date().toISOString(),
      },
    },
  ],
  [
    'mock-fitness',
    {
      userId: 'mock-fitness',
      description: 'Enthusiast for sports, yoga, outdoor activities, and wellness',
      profile: {
        userId: 'mock-fitness',
        embedding: generateBiasedEmbedding({
          // Bias toward fitness/sports/wellness dimensions
          75: 0.9, 150: 0.8, 225: 0.7, 300: 0.6,
          375: 0.8, 450: 0.7, 525: 0.6,
        }),
        contentTypeAffinity: {
          event: 0.8,
          'flash-offer': 0.8,  // Loves fitness deals
          poll: 0.2,
          request: 0.3,
          announcement: 0.2,
          photo: 0.5,
        },
        timeOfDayPatterns: {
          morning: 45,  // Morning workout person
          afternoon: 20,
          evening: 25,
          night: 10,
        },
        engagementStyle: {
          isDeepReader: false,
          scrollsDeep: true,
          quickBrowser: false,
          avgDwellTime: 6.8,
          avgPosition: 30,
        },
        totalInteractions: 180,
        lastActiveAt: new Date().toISOString(),
      },
    },
  ],
  [
    'mock-culture',
    {
      userId: 'mock-culture',
      description: 'Passionate about music, arts, theater, and cultural events',
      profile: {
        userId: 'mock-culture',
        embedding: generateBiasedEmbedding({
          // Bias toward arts/culture/music dimensions
          60: 0.9, 120: 0.8, 180: 0.7, 240: 0.8,
          300: 0.6, 360: 0.7, 420: 0.6,
        }),
        contentTypeAffinity: {
          event: 0.95,  // Loves cultural events
          'flash-offer': 0.6,
          poll: 0.5,
          request: 0.4,
          announcement: 0.6,
          photo: 0.7,  // Enjoys visual content
        },
        timeOfDayPatterns: {
          morning: 10,
          afternoon: 20,
          evening: 50,  // Evening event person
          night: 20,
        },
        engagementStyle: {
          isDeepReader: true,
          scrollsDeep: true,
          quickBrowser: false,
          avgDwellTime: 15.3,
          avgPosition: 35,
        },
        totalInteractions: 165,
        lastActiveAt: new Date().toISOString(),
      },
    },
  ],
  [
    'mock-explorer',
    {
      userId: 'mock-explorer',
      description: 'Curious about everything - balanced interests across all categories',
      profile: {
        userId: 'mock-explorer',
        embedding: generateBiasedEmbedding({
          // Even distribution - small biases across many dimensions
          100: 0.3, 200: 0.3, 300: 0.3, 400: 0.3,
          500: 0.3, 600: 0.3, 700: 0.3, 800: 0.3,
        }),
        contentTypeAffinity: {
          event: 0.7,
          'flash-offer': 0.7,
          poll: 0.7,
          request: 0.7,
          announcement: 0.7,
          photo: 0.7,
        },
        timeOfDayPatterns: {
          morning: 25,
          afternoon: 25,
          evening: 25,
          night: 25,  // Active at all times
        },
        engagementStyle: {
          isDeepReader: false,
          scrollsDeep: true,
          quickBrowser: false,
          avgDwellTime: 8.5,
          avgPosition: 28,
        },
        totalInteractions: 140,
        lastActiveAt: new Date().toISOString(),
      },
    },
  ],
]);

// Helper to check if a userId is a mock persona
export function isMockPersona(userId: string): boolean {
  return userId.startsWith('mock-');
}

// Get persona profile by userId
export function getPersonaProfile(userId: string): UserProfile | null {
  const persona = MOCK_PERSONAS.get(userId);
  return persona ? persona.profile : null;
}
