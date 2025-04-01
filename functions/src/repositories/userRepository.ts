// Repository for accessing User data in Firestore
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { User, IUserData } from '../models/User';

const db = getFirestore();
const USERS_COLLECTION = "users";

type UserUpdateData = Partial<Omit<IUserData, 'id'>>;

async function findByTelegramId(telegramId: string | number): Promise<User | null> {
  const snapshot = await db.collection(USERS_COLLECTION)
                         .where("telegramId", "==", String(telegramId))
                         .limit(1)
                         .get();
  if (snapshot.empty) {
    return null;
  }
  const doc = snapshot.docs[0];
  return new User({ id: doc.id, ...doc.data() } as IUserData);
}

async function createUser(userData: Omit<IUserData, 'id'>): Promise<User> {
  const now = Timestamp.now();
  const userWithTimestamps = {
    ...userData,
    createdAt: now,
    updatedAt: now
  };
  
  const docRef = db.collection(USERS_COLLECTION).doc(String(userData.telegramId));
  await docRef.set(userWithTimestamps);
  const snapshot = await docRef.get();
  return new User({ id: snapshot.id, ...snapshot.data() } as IUserData);
}

async function updateUser(docId: string, updateData: UserUpdateData): Promise<User> {
  const docRef = db.collection(USERS_COLLECTION).doc(docId);
  const dataWithTimestamp = {
    ...updateData,
    updatedAt: Timestamp.now()
  };
  await docRef.update(dataWithTimestamp);
  const updatedDoc = await docRef.get();
  return new User({ id: updatedDoc.id, ...updatedDoc.data() } as IUserData);
}

async function findByUsernameOrName(query: string): Promise<User | null> {
  //@TODO: Revise this
  const normalized = query.replace(/^@/, "").trim();
  let snapshot = await db.collection(USERS_COLLECTION)
                          .where('username', '==', normalized)
                          .limit(1).get();
  if (!snapshot.empty) return new User({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as IUserData);

  return null;
}

export {
  findByTelegramId,
  createUser,
  updateUser,
  findByUsernameOrName
}; 