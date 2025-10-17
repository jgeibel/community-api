import { firestore } from '../firebase/admin';

type CollectionName =
  | 'events'
  | 'eventSeries'
  | 'userPinnedEvents'
  | 'interactions'
  | 'tagProposals'
  | 'tags'
  | 'profiles'
  | 'status'
  | 'flights';

const DEFAULT_BATCH_SIZE = 300;

async function deleteCollection(name: CollectionName, batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
  const collectionRef = firestore.collection(name);
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
): Promise<void> {
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
  }
}

async function main() {
  const targets: CollectionName[] = [
    'events',
    'eventSeries',
    'userPinnedEvents',
    'interactions',
    'tagProposals',
    'tags',
    'profiles',
    'status',
    'flights',
  ];

  for (const name of targets) {
    console.log(`Purging collection: ${name}`);
    const count = await deleteCollection(name);
    console.log(`  Deleted ${count} documents from ${name}`);
  }

  console.log('Firestore reset complete.');
}

main().then(
  () => {
    process.exit(0);
  },
  error => {
    console.error('Failed to reset Firestore', error);
    process.exit(1);
  },
);
