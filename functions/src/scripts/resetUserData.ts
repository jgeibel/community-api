import { firestore } from '../firebase/admin';

const DEFAULT_BATCH_SIZE = 300;

async function deleteCollection(
  collectionPath: string,
  batchSize = DEFAULT_BATCH_SIZE,
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
      await deleteDocumentSubcollections(doc.ref);
      batch.delete(doc.ref);
    }
    await batch.commit();
    deleted += snapshot.size;
  }

  return deleted;
}

async function deleteDocumentSubcollections(docRef: FirebaseFirestore.DocumentReference): Promise<void> {
  const subcollections = await docRef.listCollections();
  for (const subcollection of subcollections) {
    await deleteCollectionReference(subcollection);
  }
}

async function deleteCollectionReference(
  collectionRef: FirebaseFirestore.CollectionReference,
  batchSize = DEFAULT_BATCH_SIZE,
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
      await deleteDocumentSubcollections(doc.ref);
      batch.delete(doc.ref);
    }
    await batch.commit();
    deleted += snapshot.size;
  }

  return deleted;
}

async function deleteCollectionGroup(
  collectionId: string,
  batchSize = DEFAULT_BATCH_SIZE,
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

async function resetUserArtifacts(): Promise<void> {
  console.log('Deleting interactions…');
  const interactionsDeleted = await deleteCollection('interactions');
  console.log(`  Deleted ${interactionsDeleted} interaction documents`);

  console.log('Deleting user profiles cache…');
  const profilesDeleted = await deleteCollection('profiles');
  console.log(`  Deleted ${profilesDeleted} profile documents`);

  console.log('Deleting pinned events…');
  const pinnedDeleted = await deleteCollection('userPinnedEvents');
  console.log(`  Deleted ${pinnedDeleted} pinned event documents`);

  console.log('Deleting user-level category bundle state…');
  const bundleDocsDeleted = await deleteCollectionGroup('categoryBundles');
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

async function resetCatalog(): Promise<void> {
  const catalogs = ['events', 'eventSeries', 'eventCategories'];
  for (const collection of catalogs) {
    console.log(`Deleting ${collection}…`);
    const deleted = await deleteCollection(collection);
    console.log(`  Deleted ${deleted} documents from ${collection}`);
  }
}

async function main() {
  const resetCatalogFlag = process.argv.includes('--catalog');

  if (resetCatalogFlag) {
    console.warn('WARNING: Catalog reset will delete event, series, and category documents.');
    await resetCatalog();
  } else {
    console.log('Skipping catalog reset (run with --catalog to enable).');
  }

  await resetUserArtifacts();
  console.log('User data reset complete.');
}

main().then(
  () => process.exit(0),
  error => {
    console.error('Failed to reset user data', error);
    process.exit(1);
  }
);
