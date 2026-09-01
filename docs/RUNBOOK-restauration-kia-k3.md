# Runbook — Restauration du Kia K3 (PITR Supabase) + correctif anti-récidive

**Contexte.** La suppression d'un chauffeur a effacé physiquement le véhicule qui lui
était assigné (Kia K3), via le FK `fleet.vehicles.driver_id → fleet.profiles(id)`
déclaré `ON DELETE CASCADE`. La ligne n'existe plus : il n'y a rien à réactiver, il
faut soit la restaurer depuis un backup, soit la recréer.

**Cible de restauration : `2026-08-31 22:35 UTC`** (= 22h35 heure de Dakar, le Sénégal
étant à UTC+0), soit ~10 min avant le signalement du problème (22:45 UTC).
👉 Vérifier cet horodatage avant d'exécuter : le PITR est irréversible.

---

## ⚠️ À lire avant de lancer un PITR

Un PITR Supabase restaure **toute la base**, pas seulement le véhicule :

- Tout ce qui a été écrit après 22:35 UTC est perdu : rapports journaliers soumis,
  dépenses, validations admin, paiements, comptes créés.
- Le projet est **indisponible** pendant la restauration (quelques minutes).
- Le PITR couvre Postgres, **pas le Storage** : les fichiers KYC déjà uploadés
  restent dans le bucket alors que leurs lignes en base reviennent en arrière —
  des `uploads` orphelins sont possibles.
- Le chauffeur supprimé **revient aussi** (profil + compte auth), puisque la base
  entière revient à son état de 22:35.
- Prérequis : PITR activé (plan Pro + add‑on). Sans PITR, seuls les backups
  quotidiens sont disponibles — voir l'option C.

Si la perte des ~30 min d'activité n'est pas acceptable, **préférer l'option B**.

---

## Option A — PITR en place (ce qui a été demandé)

1. Prévenir les utilisateurs : l'application sera coupée quelques minutes.
2. Supabase Dashboard → **Database → Backups → Point in Time**.
3. Choisir **`31/08/2026 22:35`**, fuseau **UTC**. Confirmer.
4. Attendre la fin de la restauration (le projet redémarre seul).
5. Vérifier que le véhicule est revenu :

   ```sql
   SELECT id, plate, make, model, year, mileage, status, driver_id
     FROM fleet.vehicles
    WHERE upper(model) LIKE '%K3%' OR upper(make) = 'KIA';
   ```

6. **Obligatoire** — appliquer le correctif, sinon le bug se reproduit à la
   prochaine suppression de chauffeur :

   ```
   migrations/045-fix-suppression-chauffeur-supprime-vehicule.sql
   ```

   (Supabase Dashboard → SQL Editor, coller le fichier, exécuter.)

7. Vérifier que le correctif est bien en place :

   ```sql
   -- doit renvoyer confdeltype = 'n' (SET NULL), et non 'c' (CASCADE)
   SELECT con.conname, con.confdeltype
     FROM pg_constraint con
     JOIN pg_class     rel ON rel.oid = con.conrelid
     JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'fleet' AND rel.relname = 'vehicles' AND con.contype = 'f';

   -- la corbeille doit exister
   SELECT to_regclass('fleet.vehicles_archive');
   ```

8. Re‑supprimer le chauffeur si c'était bien l'intention : cette fois le véhicule
   restera, simplement désassigné (« Non assigné » dans Admin → Véhicules).

---

## Option B — Restauration chirurgicale (aucune perte de données)

Récupère le Kia K3 **sans** faire reculer la prod.

1. Dashboard → **Database → Backups → Point in Time → Restore to a new project**
   (ou une branche de preview), horodatage `31/08/2026 22:35 UTC`.
2. Sur le projet restauré, lire la ligne d'origine :

   ```sql
   SELECT * FROM fleet.vehicles WHERE upper(make) = 'KIA' AND upper(model) LIKE '%K3%';
   SELECT * FROM fleet.vehicle_maintenance
    WHERE vehicle_id = '<id-du-vehicule-ci-dessus>';
   ```

3. Appliquer `migrations/045-...sql` **sur la prod**.
4. Réinsérer la ligne en prod avec les valeurs relevées, en reprenant le bloc C de
   `sql/restore-kia-k3.sql` (garder `driver_id = NULL` si le chauffeur n'existe plus).
5. Supprimer le projet de restauration.

---

## Option C — Ni PITR ni backup exploitable

Appliquer `migrations/045-...sql`, puis exécuter `sql/restore-kia-k3.sql` (bloc C)
en renseignant la plaque : la fiche est recréée, non assignée.
Les données non saisies (VIN, kilométrage, dates d'assurance et de visite) seront
à ressaisir.

---

## Après coup

Le correctif rend toute suppression de véhicule réversible : chaque ligne effacée
de `fleet.vehicles` est copiée dans `fleet.vehicles_archive`.

```sql
-- ce qui est récupérable
SELECT plate, deleted_at, data->>'make' AS make, data->>'model' AS model
  FROM fleet.vehicles_archive ORDER BY deleted_at DESC;

-- restaurer
SELECT fleet.restore_vehicle('LA-PLAQUE');
```
