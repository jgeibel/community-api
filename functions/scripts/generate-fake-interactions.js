const https = require('https');

const API_KEY = '05413fbc45028b7295bbc6cffbdc506829b3c3457039c06dbc2ff6f54ea79348';
const API_BASE = 'https://us-central1-community-api-ba17c.cloudfunctions.net/api/api';

// Sample events with tags from the feed
const EVENTS = [
  { id: 'google-calendar:007c8904d97ab1f21a718fab5eab13f5d95d1b0506be7352161bae2aafa8bdd2@group.calendar.google.com:2r0he3nbh27cgor8b7lho7k2es_20250930T170000Z', tags: ['contemporary', 'hayley'] },
  { id: 'google-calendar:007c8904d97ab1f21a718fab5eab13f5d95d1b0506be7352161bae2aafa8bdd2@group.calendar.google.com:30dghddvcec91te7hl4apchni1_20250930T183000Z', tags: ['baby', 'hayley'] },
  { id: 'google-calendar:007c8904d97ab1f21a718fab5eab13f5d95d1b0506be7352161bae2aafa8bdd2@group.calendar.google.com:13a35sbp4g7te00eqd2380nkpl_20250930T223000Z', tags: ['education', 'afterschool', 'rosedanie', 'cooking'] },
  { id: 'google-calendar:007c8904d97ab1f21a718fab5eab13f5d95d1b0506be7352161bae2aafa8bdd2@group.calendar.google.com:27v6c2u1cmt8kmgi6omd6oa208_20250930T223000Z', tags: ['education', 'hayley', 'modern'] },
  { id: 'google-calendar:007c8904d97ab1f21a718fab5eab13f5d95d1b0506be7352161bae2aafa8bdd2@group.calendar.google.com:362ssvfipb79ukhsv97et59dps_20250930T223000Z', tags: ['education', 'tiffany', 'ballet'] },
  { id: 'google-calendar:007c8904d97ab1f21a718fab5eab13f5d95d1b0506be7352161bae2aafa8bdd2@group.calendar.google.com:50k801sc77cik5vpck2a2omjgh_20250930T223000Z', tags: ['sports', 'jill'] },
  { id: 'google-calendar:007c8904d97ab1f21a718fab5eab13f5d95d1b0506be7352161bae2aafa8bdd2@group.calendar.google.com:51le0nfsc3mgu7255n36ips4kh_20250930T223000Z', tags: ['sports', 'soccer'] },
  { id: 'google-calendar:007c8904d97ab1f21a718fab5eab13f5d95d1b0506be7352161bae2aafa8bdd2@group.calendar.google.com:5as6c0uat2m6ad02cj4hv40dp7_20250930T223000Z', tags: ['sports', 'soccer'] },
  { id: 'google-calendar:007c8904d97ab1f21a718fab5eab13f5d95d1b0506be7352161bae2aafa8bdd2@group.calendar.google.com:72n9tphobhjkk2fpo2k1dk2p4c_20250930T232500Z', tags: ['education', 'hayley'] },
];

const ACTIONS = ['viewed', 'liked', 'shared', 'bookmarked', 'dismissed', 'not-interested'];
const TIMES = ['morning', 'afternoon', 'evening', 'night'];
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// User personas with preferences
const USERS = [
  { id: 'sports-fan', preferences: { sports: 0.8, education: 0.2 } },
  { id: 'dance-lover', preferences: { contemporary: 0.9, ballet: 0.8, modern: 0.7 } },
  { id: 'parent', preferences: { baby: 0.9, afterschool: 0.8, cooking: 0.6 } },
  { id: 'education-focused', preferences: { education: 0.9, cooking: 0.5 } },
];

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shouldInteract(event, userPrefs) {
  // Check if any event tag matches user preferences
  for (const tag of event.tags) {
    if (userPrefs[tag] && Math.random() < userPrefs[tag]) {
      return true;
    }
  }
  return Math.random() < 0.1; // 10% random exploration
}

function getActionForUser(userPrefs, event) {
  // More likely to like/bookmark if it matches preferences
  const matchScore = event.tags.reduce((max, tag) =>
    Math.max(max, userPrefs[tag] || 0), 0);

  if (matchScore > 0.7) {
    return randomChoice(['liked', 'bookmarked', 'viewed']);
  } else if (matchScore > 0.4) {
    return randomChoice(['viewed', 'liked', 'dismissed']);
  } else {
    return randomChoice(['viewed', 'dismissed', 'not-interested']);
  }
}

function generateInteractions() {
  const interactions = [];
  let sessionCounter = 0;

  for (const user of USERS) {
    // Generate 25-40 interactions per user (need 20+ for personalization)
    const numInteractions = 25 + Math.floor(Math.random() * 16);

    for (let i = 0; i < numInteractions; i++) {
      const event = randomChoice(EVENTS);

      // Skip some events based on user preferences
      if (!shouldInteract(event, user.preferences)) {
        continue;
      }

      const action = getActionForUser(user.preferences, event);

      interactions.push({
        userId: user.id,
        contentId: event.id,
        contentType: 'event',
        action: action,
        dwellTime: action === 'viewed' ? 1000 + Math.random() * 5000 : undefined,
        context: {
          position: i,
          sessionId: `session-${user.id}-${sessionCounter++}`,
          timeOfDay: randomChoice(TIMES),
          dayOfWeek: randomChoice(DAYS),
        },
        contentTags: event.tags,
      });
    }
  }

  return interactions;
}

function postBatch(interactions) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ interactions });

    const options = {
      hostname: 'us-central1-community-api-ba17c.cloudfunctions.net',
      port: 443,
      path: '/api/api/interactions/batch',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'X-API-Key': API_KEY,
      },
    };

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 201) {
          resolve(JSON.parse(responseData));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('Generating fake interactions...');
  const interactions = generateInteractions();
  console.log(`Generated ${interactions.length} interactions for ${USERS.length} users`);

  // Split into batches of 100
  const batches = [];
  for (let i = 0; i < interactions.length; i += 100) {
    batches.push(interactions.slice(i, i + 100));
  }

  console.log(`Uploading ${batches.length} batches...`);

  for (let i = 0; i < batches.length; i++) {
    try {
      const result = await postBatch(batches[i]);
      console.log(`Batch ${i + 1}/${batches.length}: ${result.count} interactions recorded`);
    } catch (error) {
      console.error(`Batch ${i + 1} failed:`, error.message);
    }
  }

  console.log('Done!');
}

main();
