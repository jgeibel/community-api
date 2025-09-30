const path = require('path');
const envPath = path.resolve(__dirname, '../../.env');
require('dotenv').config({ path: envPath });
const { EventTagClassifier } = require('../../lib/classification/eventClassifier');

async function runSample(title, description) {
  const classifier = new EventTagClassifier();
  const result = await classifier.classify({ title, description });
  console.log('\n---', title, '---');
  console.log('Tags:', result.tags?.length ? result.tags.join(', ') : '(none)');
  if (result.candidates?.length) {
    const summary = result.candidates
      .slice(0, 3)
      .map(candidate => `${candidate.tag} (${candidate.confidence.toFixed(2)} via ${candidate.source})`)
      .join('; ');
    console.log('Top candidates:', summary);
  } else {
    console.log('Top candidates: (none)');
  }
  const { metadata } = result;
  console.log(
    `Metadata: llmUsed=${metadata?.llmUsed ?? false}, embeddingsUsed=${metadata?.embeddingsUsed ?? false}`
  );
}

(async () => {
  await runSample(
    'Drop-in Basketball (ages 35+)',
    'Weekly drop-in session at the Old Gym. Ages 35 and older. All positions welcome. Indoor recreational basketball.'
  );
  await runSample(
    "Kid's Cooking - Around the World w/ Hiba!",
    'Hands-on culinary adventure for kids learning global recipes alongside chef Hiba.'
  );
})();
