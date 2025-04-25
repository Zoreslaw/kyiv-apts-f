import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';

initializeApp({ projectId: 'kyiv-apts-local-test' });
const db = getFirestore();
db.settings({ host: 'localhost:8080', ssl: false });

const dataPath = path.resolve(__dirname, '../functions/firestore-export.json');
const raw = fs.readFileSync(dataPath, 'utf8');
const data = JSON.parse(raw);

const restoreTimestamps = (obj: any): any => {
    for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (val && typeof val === 'object' && '_seconds' in val && '_nanoseconds' in val) {
            obj[key] = new Timestamp(val._seconds, val._nanoseconds);
        } else if (val && typeof val === 'object') {
            obj[key] = restoreTimestamps(val);
        }
    }
    return obj;
};

const seed = async () => {
    for (const [collectionName, documents] of Object.entries(data)) {
        console.log(`📂 Seeding collection: ${collectionName}`);
        for (const doc of documents as any[]) {
            const docId = doc.id;
            delete doc.id;
            const restored = restoreTimestamps(doc);
            await db.collection(collectionName).doc(docId).set(restored);
            console.log(`✅ Added ${docId} to ${collectionName}`);
        }
    }
    console.log('🎉 Firestore successfully seeded from firestore-export.json');
};

seed();