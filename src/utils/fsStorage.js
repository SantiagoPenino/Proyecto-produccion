const DB_NAME = 'FileSystemStorageDB';
const STORE_NAME = 'handles';

// Inicializa IndexedDB
const initDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.error);
    });
};

export const saveDirectoryHandle = async (key, handle) => {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put(handle, key);
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error("Error saving directory handle:", error);
        return false;
    }
};

export const getDirectoryHandle = async (key) => {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error("Error getting directory handle:", error);
        return null;
    }
};

export const verifyPermission = async (handle, mode = 'readwrite') => {
    if (!handle) return false;
    
    // Check if permission was already granted
    if (await handle.queryPermission({ mode }) === 'granted') {
        return true;
    }
    
    // Request permission to the user
    if (await handle.requestPermission({ mode }) === 'granted') {
        return true;
    }
    
    return false;
};
