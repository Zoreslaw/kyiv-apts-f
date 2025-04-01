// Repository for accessing User data in Firestore
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { User, IUserData } from '../models/User';

const db = getFirestore();
const USERS_COLLECTION = "users";

type UserUpdateData = Partial<Omit<IUserData, 'id'>>;

async function findByTelegramId(telegramId: string | number): Promise<User | null> {
  try {
    const normalizedId = String(telegramId);
    
    // Try by userId first
    let snap = await db
      .collection("users")
      .where("userId", "==", parseInt(normalizedId))
      .limit(1)
      .get();
    
    if (!snap.empty) {
      return new User(snap.docs[0].data() as IUserData);
    }

    // Try by chatId
    snap = await db
      .collection("users")
      .where("chatId", "==", parseInt(normalizedId))
      .limit(1)
      .get();
    
    if (!snap.empty) {
      return new User(snap.docs[0].data() as IUserData);
    }

    return null;
  } catch (error) {
    console.error("Error in findByTelegramId:", error);
    return null;
  }
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

export async function lookupUserByNameOrUsername(query: string): Promise<User | null> {
  try {
    const normalized = query.replace(/^@/, "").trim();
    
    // 1) Try exact username match
    let snap = await db
      .collection("users")
      .where("username", "==", normalized)
      .limit(1)
      .get();
    if (!snap.empty) {
      return new User(snap.docs[0].data() as IUserData);
    }

    // 2) Try exact firstName
    snap = await db
      .collection("users")
      .where("firstName", "==", normalized)
      .limit(1)
      .get();
    if (!snap.empty) {
      return new User(snap.docs[0].data() as IUserData);
    }

    // 3) Try exact lastName
    snap = await db
      .collection("users")
      .where("lastName", "==", normalized)
      .limit(1)
      .get();
    if (!snap.empty) {
      return new User(snap.docs[0].data() as IUserData);
    }

    return null;
  } catch (error) {
    console.error("Error in lookupUserByNameOrUsername:", error);
    return null;
  }
}

export {
  findByTelegramId,
  createUser,
  updateUser,
  findByUsernameOrName
}; 