#!/usr/bin/env bash
# Botu yeni bir GitHub hesabina kurar.
#
# ONCE: yeni hesapla giris yap
#   gh auth login          (tarayici acilir; scope olarak repo + workflow sec)
# SONRA:
#   ./setup-account.sh
#
# Yaptigi: repo'yu olusturur, kodu push'lar, iki secret'i yazar,
# zamanlamayi acar ve dogrulama icin bir calisma tetikler.

set -euo pipefail
cd "$(dirname "$0")"

REPO_NAME="${REPO_NAME:-flightbot}"

echo "==> Aktif hesap kontrolu"
USER=$(gh api user --jq .login)
echo "    Giris yapilmis hesap: $USER"
read -r -p "    Bu hesaba kurulsun mu? [e/H] " ok
[[ "$ok" == "e" || "$ok" == "E" ]] || { echo "iptal edildi"; exit 1; }

echo "==> config.json kontrolu"
[ -f config.json ] || { echo "HATA: config.json yok. config.example.json'dan kopyalayip duzenle."; exit 1; }
node -e "JSON.parse(require('fs').readFileSync('config.json','utf8'))" || { echo "HATA: config.json gecerli JSON degil"; exit 1; }
WEBHOOK=$(node -e "console.log(require('./config.json').discordWebhook||'')")
[ -n "$WEBHOOK" ] || { echo "HATA: config.json icinde discordWebhook bos"; exit 1; }

echo "==> Zamanlama aciliyor (schedule)"
# Workflow'daki yorumlanmis cron satirlarini geri ac
node - <<'EOF'
const fs = require('fs');
const p = '.github/workflows/check.yml';
const s = fs.readFileSync(p, 'utf8');

// "on:" blogunu (bir sonraki ust seviye anahtara kadar) bilinen dogru
// haliyle bastan yaz — yorum kaldirmaya calismaktan daha guvenli.
const block = [
  'on:',
  '  schedule:',
  "    - cron: '*/20 * * * *'",
  '  workflow_dispatch:',
  '',
  '',
].join('\n');

// Sadece girintili satirlari ve bos satirlari yut; sutun 0'daki yorumlar
// bir sonraki bloga ait, onlara dokunma.
const out = s.replace(/^on:\n(?:[ \t].*\n|\n)*/m, block);
if (!/^\s{2}schedule:$/m.test(out) || !/^\s{4}- cron:/m.test(out)) {
  console.error('HATA: schedule acilamadi, .github/workflows/check.yml dosyasini elle duzelt');
  process.exit(1);
}
fs.writeFileSync(p, out);
console.log('    schedule acildi (her 20 dk)');
EOF

git add -A
git diff --cached --quiet || git commit -q -m "Zamanlamayi yeniden ac"

echo "==> Repo olusturuluyor: $USER/$REPO_NAME (public)"
if gh repo view "$USER/$REPO_NAME" >/dev/null 2>&1; then
  echo "    zaten var, remote guncelleniyor"
  git remote remove origin 2>/dev/null || true
  git remote add origin "https://github.com/$USER/$REPO_NAME.git"
  git push -u origin main --force
else
  git remote remove origin 2>/dev/null || true
  gh repo create "$REPO_NAME" --public --source=. --push \
    --description "Ucuz bilet takip botu"
fi

echo "==> Secret'lar yaziliyor"
gh secret set DISCORD_WEBHOOK --body "$WEBHOOK" --repo "$USER/$REPO_NAME"

# Ilk dogrulama icin esigi gecici yukseltmek istersen:
#   TEST_THRESHOLD=16000 ./setup-account.sh
# Boylece kurulur kurulmaz bildirim gelir ve calistigi gorulur.
if [ -n "${TEST_THRESHOLD:-}" ]; then
  echo "    CONFIG_JSON esigi gecici $TEST_THRESHOLD yapiliyor"
  node -e "
    const c=require('./config.json');
    c.alertThresholdTRY=Number(process.env.TEST_THRESHOLD);
    c.logThresholdTRY=Number(process.env.TEST_THRESHOLD);
    require('fs').writeFileSync('/tmp/config-test.json', JSON.stringify(c,null,2));
  "
  gh secret set CONFIG_JSON < /tmp/config-test.json --repo "$USER/$REPO_NAME"
  rm -f /tmp/config-test.json
  echo "    NOT: test bittikten sonra gercek esige don:"
  echo "         gh secret set CONFIG_JSON < config.json --repo $USER/$REPO_NAME"
else
  gh secret set CONFIG_JSON < config.json --repo "$USER/$REPO_NAME"
fi
gh secret list --repo "$USER/$REPO_NAME"

echo "==> Dogrulama calismasi tetikleniyor"
gh workflow run check.yml --repo "$USER/$REPO_NAME"
sleep 20
gh run list --workflow=check.yml --repo "$USER/$REPO_NAME" --limit 3

cat <<EOF

Kurulum bitti: https://github.com/$USER/$REPO_NAME
Calismayi izlemek icin:
  gh run watch --repo $USER/$REPO_NAME
EOF
