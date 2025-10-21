import { firestore } from '../firebase/admin';

const DEFAULT_BATCH_SIZE = 20;

type CliOptions = {
  batchSize: number;
  resetCatalog: boolean;
};

function parseCliOptions(argv: string[]): CliOptions {
  let batchSize = DEFAULT_BATCH_SIZE;
  let resetCatalog = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--catalog') {
      resetCatalog = true;
      continue;
    }

    if (arg === '--batch') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('--batch flag requires a numeric value');
      }
      batchSize = parseBatchSize(next);
      index += 1;
      continue;
    }

    if (arg.startsWith('--batch=')) {
      const [, value] = arg.split('=');
      if (!value) {
        throw new Error('--batch flag requires a numeric value');
      }
      batchSize = parseBatchSize(value);
      continue;
    }
  }

  return { batchSize, resetCatalog };
}

function parseBatchSize(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid batch size: ${raw}`);
  }
  return Math.min(parsed, 500);
}

async function deleteCollection(
  collectionPath: string,
  batchSize: number,
): Promise<number> {
  const collectionRef = firestore.collection(collectionPath);
  let deleted = 0;

  while (true) {
    const snapshot = await collectionRef.limit(batchSize).get();
    if (snapshot.empty) {
      break;
    }

    const batch = firestore.batch();
    for (const doc of snapshot.docs) {
      await deleteDocumentSubcollections(doc.ref, batchSize);
      batch.delete(doc.ref);
    }
    await batch.commit();
    deleted += snapshot.size;
  }

  return deleted;
}

async function deleteDocumentSubcollections(
  docRef: FirebaseFirestore.DocumentReference,
  batchSize: number,
): Promise<void> {
  const subcollections = await docRef.listCollections();
  for (const subcollection of subcollections) {
    await deleteCollectionReference(subcollection, batchSize);
  }
}

async function deleteCollectionReference(
  collectionRef: FirebaseFirestore.CollectionReference,
  batchSize: number,
): Promise<number> {
  let deleted = 0;
  // Iterate in batches to stay within Firestore limits
  while (true) {
    const snapshot = await collectionRef.limit(batchSize).get();
    if (snapshot.empty) {
      break;
    }

    const batch = firestore.batch();
    for (const doc of snapshot.docs) {
      await deleteDocumentSubcollections(doc.ref, batchSize);
      batch.delete(doc.ref);
    }
    await batch.commit();
    deleted += snapshot.size;
  }

  return deleted;
}

async function deleteCollectionGroup(
  collectionId: string,
  batchSize: number,
): Promise<number> {
  let deleted = 0;
  while (true) {
    const snapshot = await firestore.collectionGroup(collectionId).limit(batchSize).get();
    if (snapshot.empty) {
      break;
    }

    const batch = firestore.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    deleted += snapshot.size;
  }
  return deleted;
}

async function resetUserArtifacts(batchSize: number): Promise<void> {
  console.log('Deleting interactions…');
  const interactionsDeleted = await deleteCollection('interactions', batchSize);
  console.log(`  Deleted ${interactionsDeleted} interaction documents`);

  console.log('Deleting user profiles cache…');
  const profilesDeleted = await deleteCollection('profiles', batchSize);
  console.log(`  Deleted ${profilesDeleted} profile documents`);

  console.log('Deleting pinned events…');
  const pinnedDeleted = await deleteCollection('userPinnedEvents', batchSize);
  console.log(`  Deleted ${pinnedDeleted} pinned event documents`);

  console.log('Deleting user-level category bundle state…');
  const bundleDocsDeleted = await deleteCollectionGroup('categoryBundles', batchSize);
  console.log(`  Deleted ${bundleDocsDeleted} category bundle state documents`);

  console.log('Cleaning up empty user documents…');
  const usersSnapshot = await firestore.collection('users').get();
  if (!usersSnapshot.empty) {
    const batch = firestore.batch();
    usersSnapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    console.log(`  Deleted ${usersSnapshot.size} user documents`);
  } else {
    console.log('  No user documents found');
  }
}

async function resetCatalogCollections(batchSize: number): Promise<void> {
  const catalogs = ['events', 'eventSeries', 'eventCategories', 'eventHosts'];
  for (const collection of catalogs) {
    console.log(`Deleting ${collection}…`);
    const deleted = await deleteCollection(collection, batchSize);
    console.log(`  Deleted ${deleted} documents from ${collection}`);
  }
}

async function main() {
  const { batchSize, resetCatalog: shouldResetCatalog } = parseCliOptions(process.argv.slice(2));

  console.log(`Using batch size ${batchSize}`);

  if (shouldResetCatalog) {
    console.warn('WARNING: Catalog reset will delete event, series, and category documents.');
    await resetCatalogCollections(batchSize);
  } else {
    console.log('Skipping catalog reset (run with --catalog to enable).');
  }

  await resetUserArtifacts(batchSize);
  console.log('User data reset complete.');
}

main().then(
  () => process.exit(0),
  error => {
    console.error('Failed to reset user data', error);
    process.exit(1);
  }
);
