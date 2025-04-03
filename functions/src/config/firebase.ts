import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin
initializeApp();
const db = getFirestore();

export { db }; 