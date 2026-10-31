// Persistenza locale delle bozze Comics tramite IndexedDB.
// Le foto locali sono salvate una sola volta come Blob; quelle GraDV
// vengono ricostruite dall'ID archivio quando si riapre la bozza.

const DB_NAME = "dv-image-lab";
const DB_VERSION = 2;
const DRAFTS = "comics-drafts";
const FILES = "comics-files";

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
