# Setup Supabase Storage pour les attachments

## 1. Créer le bucket dans Supabase

### Via la console Supabase :
1. Accédez à **Storage** dans votre dashboard Supabase
2. Cliquez sur **Create bucket**
3. Nommez-le : `event-attachments`
4. Cochez **Public bucket** (les fichiers doivent être accessibles publiquement)
5. Cliquez **Create**

### Ou via l'API Supabase CLI :
```bash
npx supabase storage create event-attachments --public
```

## 2. Configurer les RLS policies

Exécutez le script SQL dans Supabase SQL Editor :
```sql
-- À copier depuis migrations/002-setup-storage.sql
```

Cela configure :
- ✅ Drivers voient/uploadent leurs propres attachments
- ✅ Admins voient tous les attachments
- ✅ Admins peuvent supprimer les attachments

## 3. Tester l'upload

1. Ouvrez le dashboard driver
2. Saisissez un événement (fuel, toll, etc.)
3. **Attach files** → Sélectionnez une photo ou PDF
4. Vérifiez dans Supabase Storage que le fichier est là :
   - **Storage → event-attachments → event-{eventId}/**

## 4. Structure de stockage

```
event-attachments/
├── event-uuid-1/
│   ├── 1704067200000-receipt.pdf
│   ├── 1704067220000-fuel-pump.jpg
│   └── 1704067240000-odometer.png
└── event-uuid-2/
    ├── 1704067300000-toll-ticket.pdf
    └── 1704067320000-control.jpg
```

Chaque événement a son dossier, les fichiers sont datés pour éviter les collisions.

## 5. Limites et sécurité

- **Taille max par fichier** : 10MB
- **Max fichiers par événement** : 5
- **Types autorisés** : Images (PNG, JPG, GIF), PDF, Documents Office
- **Accès** : Sécurisé par RLS — drivers ne voient que leurs propres fichiers

## 6. Intégration dans le code

Le composant `<AttachmentUpload>` gère tout :
- Upload progressif
- Sauvegarde métadonnées en BD
- Gestion des erreurs
- Affichage des fichiers

Utilisation :
```tsx
<AttachmentUpload 
  eventId={eventId} 
  onFileUploaded={(path) => console.log('Uploaded:', path)}
/>
```

## Troubleshooting

### "Cannot upload: bucket not found"
→ Créez le bucket (voir étape 1)

### "403 Forbidden"
→ Vérifiez les RLS policies (exécutez 002-setup-storage.sql)

### Files visible to other drivers
→ Vérifiez que le bucket est **Public** mais les RLS policies limitent l'accès par programme

## Coûts Supabase Storage

- **Gratuit** : 1 GB (ample pour photos + PDFs)
- **Au-delà** : $0.05 / GB (stockage) + transfert réseau
