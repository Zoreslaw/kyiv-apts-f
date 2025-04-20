// Repository for accessing User data in Firestore
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

const db = getFirestore();
const USERS_COLLECTION = 'users';

export interface IUserData {
  id?: string;
  telegramId: string;
  chatId: string;
  firstName: string;
  lastName: string;
  username: string;
  role: 'admin' | 'cleaner' | 'user';
  status: 'active' | 'inactive';
  assignedApartmentIds?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

export class User implements IUserData {
  id?: string;
  telegramId: string;
  chatId: string;
  firstName: string;
  lastName: string;
  username: string;
  role: 'admin' | 'cleaner' | 'user';
  status: 'active' | 'inactive';
  assignedApartmentIds: string[];
  createdAt?: Date;
  updatedAt?: Date;

  constructor(data: IUserData) {
    this.id = data.id;
    this.telegramId = data.telegramId;
    this.chatId = data.chatId;
    this.firstName = data.firstName;
    this.lastName = data.lastName;
    this.username = data.username;
    this.role = data.role;
    this.status = data.status;
    this.assignedApartmentIds = data.assignedApartmentIds || [];
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }

  isAdmin(): boolean {
    return this.role === 'admin';
  }

  isCleaner(): boolean {
    return this.role === 'cleaner';
  }

  isActive(): boolean {
    return this.status === 'active';
  }
}

type UserUpdateData = Partial<Omit<IUserData, 'id'>>;

export async function findAllUsers(): Promise<User[]> {
  try {
    const snapshot = await db.collection(USERS_COLLECTION).get();
    return snapshot.docs.map(doc => new User({
      id: doc.id,
      ...doc.data() as Omit<IUserData, 'id'>
    }));
  } catch (error) {
    logger.error('Error finding all users:', error);
    return [];
  }
}

export async function findById(id: string): Promise<User | null> {
  try {
    const doc = await db.collection(USERS_COLLECTION).doc(id).get();
    if (!doc.exists) return null;
    
    return new User({
      id: doc.id,
      ...doc.data() as Omit<IUserData, 'id'>
    });
  } catch (error) {
    logger.error(`Error finding user by ID ${id}:`, error);
    return null;
  }
}

export async function findByTelegramId(telegramId: string): Promise<User | null> {
  try {
    // Query by telegramId
    const snapshot = await db
      .collection(USERS_COLLECTION)
      .where("telegramId", "==", telegramId)
      .limit(1)
      .get();

    if (snapshot.empty) return null;
    
    const doc = snapshot.docs[0];
    return new User({
      id: doc.id,
      ...doc.data() as Omit<IUserData, 'id'>
    });
  } catch (error) {
    logger.error(`Error finding user by telegramId ${telegramId}:`, error);
    return null;
  }
}

export async function createUser(userData: IUserData): Promise<User | null> {
  try {
    const now = new Date();
    const userWithTimestamps = {
      ...userData,
      createdAt: now,
      updatedAt: now
    };
    
    // Use telegramId as document ID for easy lookup
    const docRef = db.collection(USERS_COLLECTION).doc(userData.telegramId);
    await docRef.set(userWithTimestamps);
    
    return new User({
      id: docRef.id,
      ...userWithTimestamps
    });
  } catch (error) {
    logger.error('Error creating user:', error);
    return null;
  }
}

export async function updateUser(id: string, userData: UserUpdateData): Promise<User | null> {
  try {
    const updateData = {
      ...userData,
      updatedAt: new Date()
    };
    
    await db.collection(USERS_COLLECTION).doc(id).update(updateData);
    return findById(id);
  } catch (error) {
    logger.error(`Error updating user ${id}:`, error);
    return null;
  }
}

export async function deleteUser(id: string): Promise<boolean> {
  try {
    await db.collection(USERS_COLLECTION).doc(id).delete();
    return true;
  } catch (error) {
    logger.error(`Error deleting user ${id}:`, error);
    return false;
  }
}

export async function findCleaners(): Promise<User[]> {
  try {
    const snapshot = await db
      .collection(USERS_COLLECTION)
      .where("role", "==", "cleaner")
      .where("status", "==", "active")
      .get();
    
    return snapshot.docs.map(doc => new User({
      id: doc.id,
      ...doc.data() as Omit<IUserData, 'id'>
    }));
  } catch (error) {
    logger.error('Error finding cleaners:', error);
    return [];
  }
}

export async function getOrCreateUserByTelegramId(
  telegramId: string, 
  userData: Omit<IUserData, 'id' | 'telegramId' | 'createdAt' | 'updatedAt'>
): Promise<User | null> {
  try {
    // Try to find existing user
    const existingUser = await findByTelegramId(telegramId);
    if (existingUser) return existingUser;
    
    // Create new user if not found
    return createUser({
      telegramId,
      chatId: userData.chatId,
      firstName: userData.firstName,
      lastName: userData.lastName,
      username: userData.username,
      role: userData.role || 'user',
      status: userData.status || 'active',
      assignedApartmentIds: userData.assignedApartmentIds || []
    });
  } catch (error) {
    logger.error(`Error in getOrCreateUserByTelegramId for ${telegramId}:`, error);
    return null;
  }
}

export async function findByUsernameOrName(query: string): Promise<User | null> {
  try {
    const normalized = query.replace(/^@/, "").trim();
    let snapshot = await db.collection(USERS_COLLECTION)
                          .where('username', '==', normalized)
                          .limit(1).get();
    if (!snapshot.empty) return new User({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as IUserData);

    return null;
  } catch (error) {
    logger.error("Error in findByUsernameOrName:", error);
    return null;
  }
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
    logger.error("Error in lookupUserByNameOrUsername:", error);
    return null;
  }
} 

