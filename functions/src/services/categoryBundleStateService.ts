import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { firestore } from '../firebase/admin';

export interface UserCategoryBundleState {
  categoryId: string;
  lastSeenVersion: number;
  lastSeenAt: FirebaseFirestore.Timestamp | null;
}

export class CategoryBundleStateService {
  private readonly db: FirebaseFirestore.Firestore;

  constructor(db?: FirebaseFirestore.Firestore) {
    this.db = db ?? firestore;
  }

  async getStates(userId: string, categoryIds: string[]): Promise<Map<string, UserCategoryBundleState>> {
    const results = new Map<string, UserCategoryBundleState>();
    if (!userId || categoryIds.length === 0) {
      return results;
    }

    const uniqueIds = Array.from(new Set(categoryIds));
    const docRefs = uniqueIds.map(categoryId =>
      this.db.collection('users').doc(userId).collection('categoryBundles').doc(categoryId)
    );
    const snapshots = await this.db.getAll(...docRefs);

    snapshots.forEach(snapshot => {
      if (!snapshot.exists) {
        return;
      }
      const data = snapshot.data() ?? {};
      const lastSeenVersion = typeof data.lastSeenVersion === 'number' ? data.lastSeenVersion : 0;
      const lastSeenAt = data.lastSeenAt instanceof Timestamp ? data.lastSeenAt : null;
      results.set(snapshot.id, {
        categoryId: snapshot.id,
        lastSeenVersion,
        lastSeenAt,
      });
    });

    return results;
  }

  async markSeen(userId: string, categoryId: string, version: number): Promise<void> {
    if (!userId || !categoryId || typeof version !== 'number' || Number.isNaN(version)) {
      return;
    }

    const docRef = this.db.collection('users').doc(userId).collection('categoryBundles').doc(categoryId);
    await docRef.set(
      {
        categoryId,
        lastSeenVersion: version,
        lastSeenAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
}
