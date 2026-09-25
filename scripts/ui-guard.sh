#!/usr/bin/env bash
# ui-guard.sh — garde-fou de la refonte UI v2.
# Échoue si la branche touche à la logique métier, aux données ou aux tests existants.
# Usage : bash scripts/ui-guard.sh [base]   (base par défaut : origin/main)
set -euo pipefail
BASE="${1:-origin/main}"
fail=0
say() { printf '%s\n' "$*"; }

git fetch -q origin || true
CHANGED="$(git diff --name-only "$BASE"...HEAD)"
[ -z "$CHANGED" ] && { say "ui-guard: aucun changement."; exit 0; }

# 1. Fichiers interdits (logique, API, calculs, accès aux données, infra)
FORBIDDEN='^(app/api/|lib/calc\.ts|lib/calcReel\.ts|lib/reportNet\.ts|lib/hooks/|lib/services/|lib/supabase/|lib/ai/|lib/telematics/|lib/remuneration/|lib/report-agent/|lib/reportAdapters/|lib/plans\.ts|lib/notifications\.ts|lib/push\.ts|lib/audit\.ts|lib/logAction\.ts|lib/auth/|middleware\.ts|next\.config\.ts|vercel\.json|supabase-.*\.sql|setup-.*\.(sql|js)|sql/|deploy/|\.github/)'
BAD="$(printf '%s\n' "$CHANGED" | grep -E "$FORBIDDEN" || true)"
if [ -n "$BAD" ]; then say "✗ Fichiers interdits modifiés :"; say "$BAD"; fail=1; fi

# 2. Tests et migrations existants : ajout autorisé, modification/suppression interdite
TOUCHED="$(git diff --name-only --diff-filter=MDR "$BASE"...HEAD | grep -E '^(__tests__/|migrations/)' || true)"
if [ -n "$TOUCHED" ]; then say "✗ Tests ou migrations existants modifiés/supprimés :"; say "$TOUCHED"; fail=1; fi

# 3. Nouvelles migrations : seule l'ajout de colonne ui_v2 est permis
NEW_SQL="$(git diff --name-only --diff-filter=A "$BASE"...HEAD | grep -E '^migrations/.*\.sql$' || true)"
for f in $NEW_SQL; do
  body="$(grep -vE '^\s*--' "$f" | tr -s '[:space:]' ' ')"
  if printf '%s' "$body" | grep -qiE '\b(drop|delete|truncate|update|insert|rename|grant|revoke|policy|function|trigger)\b'; then
    say "✗ $f contient une instruction interdite (DROP/DELETE/UPDATE/…)."; fail=1
  fi
  if ! printf '%s' "$body" | grep -qiE 'add column if not exists ui_v2'; then
    say "✗ $f : seule « ADD COLUMN IF NOT EXISTS ui_v2 » est autorisée."; fail=1
  fi
done

# 4. Aucune écriture Supabase NOUVELLE dans l'UI (un déplacement = autant de lignes retirées qu'ajoutées)
DIFF="$(git diff "$BASE"...HEAD -- 'app/**/*.tsx' 'components/**/*.tsx' 'lib/**/*.tsx' || true)"
PAT='\.(insert|update|upsert|delete|rpc)\('
ADD_N="$(printf '%s\n' "$DIFF" | grep -E '^\+' | grep -vE '^\+\+\+' | grep -cE "$PAT" || true)"
DEL_N="$(printf '%s\n' "$DIFF" | grep -E '^-' | grep -vE '^---' | grep -cE "$PAT" || true)"
if [ "${ADD_N:-0}" -gt "${DEL_N:-0}" ]; then
  say "✗ Écritures Supabase : $ADD_N ajoutées pour $DEL_N retirées. L'UI ne doit que déplacer les écritures existantes."; fail=1
fi
FADD="$(printf '%s\n' "$DIFF" | grep -E '^\+' | grep -cE "method: *['\"](POST|PATCH|PUT|DELETE)" || true)"
FDEL="$(printf '%s\n' "$DIFF" | grep -E '^-' | grep -cE "method: *['\"](POST|PATCH|PUT|DELETE)" || true)"
if [ "${FADD:-0}" -gt "${FDEL:-0}" ]; then
  say "✗ Appels fetch en écriture : $FADD ajoutés pour $FDEL retirés."; fail=1
fi

[ $fail -eq 0 ] && say "✓ ui-guard OK — présentation uniquement." || { say "ui-guard : ÉCHEC"; exit 1; }
