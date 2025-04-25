import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as fs from 'fs';

initializeApp({ projectId: 'kyiv-apts-local-test' });

const db = getFirestore();
db.settings({ host: 'localhost:8080', ssl: false });

const exportData = async () => {
    const collections = await db.listCollections();
    const data: Record<string, any> = {};

    for (const collection of collections) {
        const snapshot = await collection.get();
        data[collection.id] = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    }

    fs.writeFileSync('firestore-export.json', JSON.stringify(data, null, 2));
    console.log('📦 Firestore data exported to firestore-export.json');
};

exportData();
