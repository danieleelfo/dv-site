// Persistenza locale delle bozze Comics tramite IndexedDB.
// Le foto locali sono salvate una sola volta come Blob; quelle GraDV
// vengono ricostruite dall'ID archivio quando si riapre la bozza.

const DB_NAME = "dv-image-lab";
const DB_VERSION = 3;
const DRAFTS = "comics-drafts";
const FILES = "comics-files";
const UPLOADED = "uploaded-images";

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
      if (!db.objectStoreNames.contains(DRAFTS)) {
        db.createObjectStore(DRAFTS, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(FILES)) {
        db.createObjectStore(FILES, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(UPLOADED)) {
        db.createObjectStore(UPLOADED, { keyPath: "id" });
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

function fileSignature(panel) {
  return [panel.name || "", panel.type || "", panel.lastModified || 0, panel.blob?.size || 0].join("|");
}

export async function saveComicsDraft(key, draft) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([DRAFTS, FILES], "readwrite");
    const drafts = tx.objectStore(DRAFTS);
    const files = tx.objectStore(FILES);
    const getOld = drafts.get(key);

    getOld.onsuccess = () => {
      const old = getOld.result;
      const oldPanels = new Map((old?.panels || []).map(panel => [panel.id, panel]));
      const nextPanels = draft.panels.map(panel => {
        const signature = fileSignature(panel);
        const fileKey = panel.archiveId ? null : key + ":file:" + panel.id;
        const previous = oldPanels.get(panel.id);

        if (fileKey && panel.blob && previous?.signature !== signature) {
          files.put({ key: fileKey, blob: panel.blob, signature });
        }
        if (previous?.fileKey && previous.fileKey !== fileKey) {
          files.delete(previous.fileKey);
        }

        const { blob, ...metadata } = panel;
        return { ...metadata, signature, fileKey };
      });

      const nextIds = new Set(nextPanels.map(panel => panel.id));
      for (const oldPanel of oldPanels.values()) {
        if (oldPanel.fileKey && !nextIds.has(oldPanel.id)) {
          files.delete(oldPanel.fileKey);
        }
      }

      drafts.put({ key, ...draft, panels: nextPanels, savedAt: Date.now() });
    };

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error("Salvataggio bozza Comics fallito."));
    tx.onabort = () => reject(tx.error || new Error("Salvataggio bozza Comics annullato."));
  });
}

export async function loadComicsDraft(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([DRAFTS, FILES], "readonly");
    const drafts = tx.objectStore(DRAFTS);
    const files = tx.objectStore(FILES);
    let result = null;

    const request = drafts.get(key);
    request.onsuccess = () => {
      const saved = request.result;
      if (!saved) return;
      result = { ...saved, panels: saved.panels.map(panel => ({ ...panel })) };
      for (const panel of result.panels) {
        if (!panel.fileKey) continue;
        const fileRequest = files.get(panel.fileKey);
        fileRequest.onsuccess = () => {
          panel.blob = fileRequest.result?.blob || null;
        };
      }
    };

    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error("Lettura bozza Comics fallita."));
  });
}

export async function clearComicsDraft(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([DRAFTS, FILES], "readwrite");
    const drafts = tx.objectStore(DRAFTS);
    const files = tx.objectStore(FILES);
    const request = drafts.get(key);
    request.onsuccess = () => {
      for (const panel of request.result?.panels || []) {
        if (panel.fileKey) files.delete(panel.fileKey);
      }
      drafts.delete(key);
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error("Eliminazione bozza Comics fallita."));
  });
}


// Libreria Uploaded: immagini locali, indipendenti dalle singole bozze.
// La chiave include l'account: due utenti sullo stesso browser non condividono i file.
export async function saveUploadedImage(owner, file) {
  const db = await openDb();
  const record = {
    id: owner + ":uploaded:" + (globalThis.crypto?.randomUUID?.() || (Date.now() + "-" + Math.random().toString(36).slice(2))),
    owner,
    name: file.name || "image",
    type: file.type || "image/*",
    size: file.size || 0,
    lastModified: file.lastModified || Date.now(),
    createdAt: Date.now(),
    blob: file,
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(UPLOADED, "readwrite");
    tx.objectStore(UPLOADED).put(record);
    tx.oncomplete = () => resolve({ ...record, blob: undefined });
    tx.onerror = () => reject(tx.error || new Error("Salvataggio immagine Uploaded fallito."));
  });
}

export async function listUploadedImages(owner) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(UPLOADED, "readonly");
    const request = tx.objectStore(UPLOADED).getAll();
    request.onsuccess = () => resolve((request.result || [])
      .filter(item => item.owner === owner)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ blob, ...item }) => item));
    tx.onerror = () => reject(tx.error || new Error("Lettura immagini Uploaded fallita."));
  });
}

export async function getUploadedImage(id, owner) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(UPLOADED, "readonly");
    const request = tx.objectStore(UPLOADED).get(id);
    request.onsuccess = () => resolve(request.result?.owner === owner ? request.result : null);
    tx.onerror = () => reject(tx.error || new Error("Lettura immagine Uploaded fallita."));
  });
}

export async function deleteUploadedImage(id, owner) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(UPLOADED, "readwrite");
    const store = tx.objectStore(UPLOADED);
    const request = store.get(id);
    request.onsuccess = () => {
      if (request.result?.owner === owner) store.delete(id);
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error("Eliminazione immagine Uploaded fallita."));
  });
}

export async function listComicsDrafts(prefix) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFTS, "readonly");
    const request = tx.objectStore(DRAFTS).getAll();
    request.onsuccess = () => resolve((request.result || [])
      .filter(item => item.key.startsWith(prefix))
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)));
    tx.onerror = () => reject(tx.error || new Error("Elenco bozze Comics fallito."));
  });
}
