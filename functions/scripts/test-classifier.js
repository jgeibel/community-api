require('dotenv').config({ path: '../.env' });
const { EventTagClassifier } = require('../lib/classification/eventClassifier');

async function runSample(title, description) {
  const classifier = new EventTagClassifier();
  const result = await classifier.classify({ title, description });
  console.log('\n---', title, '---');
  console.log(JSON.stringify(result, null, 2));
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
