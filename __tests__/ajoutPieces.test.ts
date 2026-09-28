/**
 * Verrouille le bug du 26/09 : le sélecteur s'ouvrait, le fichier était choisi,
 * et rien ne s'ajoutait au formulaire.
 *
 * `addFiles` faisait `setPendingFiles((prev) => [...prev, ...Array.from(files)])`.
 * Le callback passé à setState n'est pas exécuté tout de suite ; l'appelant,
 * lui, fait `e.target.value = ""` juste après pour permettre de resélectionner
 * le même fichier. Or vider l'input vide aussi la `FileList`, qui est vivante.
 * Quand React évaluait enfin le callback, il ne restait plus rien à copier.
 *
 * Ce test reproduit la séquence exacte : on appelle l'ajout, on vide la liste,
 * puis seulement on laisse l'updater s'exécuter.
 */

/** FileList minimale et VIVANTE : `clear()` la vide comme le fait le navigateur. */
function fileListVivante(noms: string[]) {
  const items: File[] = noms.map((n) => ({ name: n, size: 10 } as File));
  const liste = {
    get length() { return items.length; },
    item: (i: number) => items[i] ?? null,
    [Symbol.iterator]: function* () { yield* items; },
    clear: () => { items.length = 0; },
  };
  return liste as unknown as FileList & { clear: () => void };
}

/** L'implémentation corrigée : la copie est faite AVANT de rendre la main. */
function addFilesCorrige(files: FileList | null, setState: (fn: (p: File[]) => File[]) => void) {
  if (!files || files.length === 0) return;
  const ajouts = Array.from(files);
  setState((prev) => [...prev, ...ajouts]);
}

/** L'implémentation d'origine, gardée pour montrer ce qui échouait. */
function addFilesBuggue(files: FileList | null, setState: (fn: (p: File[]) => File[]) => void) {
  if (!files) return;
  setState((prev) => [...prev, ...Array.from(files)]);
}

/** Rejoue le différé de React : l'updater n'est appliqué qu'à `flush()`. */
function etatDiffere() {
  let valeur: File[] = [];
  const enAttente: Array<(p: File[]) => File[]> = [];
  return {
    set: (fn: (p: File[]) => File[]) => { enAttente.push(fn); },
    flush: () => { for (const fn of enAttente) valeur = fn(valeur); enAttente.length = 0; return valeur; },
  };
}

describe("ajout de pièces jointes — la FileList est vivante", () => {
  it("garde le fichier même si l'input est vidé avant que React n'applique l'état", () => {
    const etat = etatDiffere();
    const liste = fileListVivante(["recu.jpg"]);

    addFilesCorrige(liste, etat.set);
    liste.clear();              // e.target.value = "" — l'input est vidé
    const apres = etat.flush(); // React applique enfin la mise à jour

    expect(apres.map((f) => f.name)).toEqual(["recu.jpg"]);
  });

  it("reproduit la perte avec l'implémentation d'origine", () => {
    const etat = etatDiffere();
    const liste = fileListVivante(["recu.jpg"]);

    addFilesBuggue(liste, etat.set);
    liste.clear();

    // C'est exactement ce qu'Abdou voyait : le fichier choisi disparaît.
    expect(etat.flush()).toEqual([]);
  });

  it("accumule plusieurs sélections successives", () => {
    const etat = etatDiffere();
    const a = fileListVivante(["a.jpg", "b.jpg"]);
    addFilesCorrige(a, etat.set);
    a.clear();
    const b = fileListVivante(["c.pdf"]);
    addFilesCorrige(b, etat.set);
    b.clear();

    expect(etat.flush().map((f) => f.name)).toEqual(["a.jpg", "b.jpg", "c.pdf"]);
  });

  it("ne fait rien quand la sélection est annulée", () => {
    const etat = etatDiffere();
    addFilesCorrige(null, etat.set);
    addFilesCorrige(fileListVivante([]), etat.set);
    expect(etat.flush()).toEqual([]);
  });
});
