// Parametri GraDV condivisi da tutte le interfacce di generazione immagini
// (ImageLab, B2B, Multifoto, Stories, LeleAdmin e le pagine di test).
// Un solo posto dove cambiare i valori ammessi per gli steps.
export const IMG_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 15];

// Porta un valore qualsiasi (es. da un elemento dell'archivio) allo step
// ammesso più vicino, così il menu non resta su un valore che non esiste.
export function nearestStep(value, fallback = 8) {
  const n = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return IMG_STEPS.reduce(
    (best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best),
    IMG_STEPS[0]
  );
}

// "Forza modifica" (strength img2img): stesso range in tutte le interfacce.
// Basso = più fedele alla foto di partenza, alto = più trasformata.
export const IMG_STRENGTH = { min: 0.15, max: 0.95, step: 0.05, default: 0.65 };