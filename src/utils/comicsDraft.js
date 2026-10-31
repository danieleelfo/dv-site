// Persistenza locale delle bozze Comics tramite IndexedDB.
// Le immagini locali sono salvate come Blob; quelle GraDV vengono
// ricostruite dall'ID archivio quando la bozza viene riaperta.

const DB_NAME = "dv-image-lab";
const DB_VERSION = 1;
const STORE_NAME = "comics-drafts";

let dbPromise;

function openDb() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB non disponibile in questo browser."));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Apertura archivio bozze fallita."));
    request.onblocked = () => reject(new Error("Archivio bozze bloccato da un'altra scheda."));
  }).catch((error) => {
    dbPromise = null;
    throw error;
  });

  return dbPromise;
}

export async function saveComicsDraft(key, draft) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({ key, ...draft, savedAt: Date.now() });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error("Salvataggio bozza Comics fallito."));
    tx.onabort = () => reject(tx.error || new Error("Salvataggio bozza Comics annullato."));
  });
}

export async function loadComicsDraft(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("Lettura bozza Comics fallita."));
  });
}

export async function clearComicsDraft(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error("Eliminazione bozza Comics fallita."));
  });
}
