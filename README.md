# Uçak Bileti Botu — IST → Bangkok / Phuket

Google Flights'ı headless Chromium ile tarar, eşiğin altındaki biletleri Discord'a `@everyone` ile bildirir.

## Neden Google Flights?

- **Skyscanner** ve **Skiplagged** ikisi de Cloudflare bot korumasının arkasında (düz istek `403` döndü),
  VDS IP'sinden sürekli sorgu atınca kısa sürede tamamen bloklanır.
- Google Flights hem **TL fiyat** veriyor, hem **aktarmalı + aktarmasız** hepsini listeliyor,
  hem de sayfa yapısı çok daha stabil.
- `from: "Istanbul"` şehir araması **hem IST hem SAW**'ı kapsıyor (log'da `[IST]` / `[SAW]` olarak görünür).

## Kurulum

```bash
npm install
npx playwright install --with-deps chromium   # VDS'te gerekli
```

## Çalıştırma

```bash
node bot.js            # sonsuz döngü, config.json'daki periyotla
node bot.js --once     # tek tur (test için)
```

Config'i değiştirmeden geçici override:

```bash
ALERT_THRESHOLD=16000 LOG_THRESHOLD=17000 INTERVAL_MIN=5 node bot.js --once
```

## config.json

| Alan | Anlamı |
|---|---|
| `alertThresholdTRY` | Bu fiyatın **altına** düşerse Discord'a bildirim gider (şu an 12000) |
| `logThresholdTRY` | Bu fiyatın altındakiler sadece log'a yazılır, bildirim gitmez (şu an 13000) |
| `intervalMinutes` | Kontrol periyodu. Test için 2, VDS'te **20** yap |
| `mentionEveryone` | `@everyone` etiketi atılsın mı |
| `searches[].minDepartureTime` | O tarih için en erken kalkış saati (5 Eylül → `"18:00"`) |
| `headless` | VDS'te mutlaka `true` |

## Tekrar bildirim mantığı

`state.json` görülen uçuşları tutar. Aynı uçuş için tekrar bildirim **sadece**:
- daha önce hiç görülmediyse,
- fiyatı bir öncekinden **daha da düştüyse**,
- ya da üzerinden 6 saat geçtiyse

gönderilir. Böylece her 20 dakikada aynı bilet spam'lenmez.

## Loglar

`logs/YYYY-MM-DD.log` — her turun özeti + eşik altı biletlerin dökümü.

```bash
tail -f logs/$(date +%F).log
```

## VDS'e kurulum (systemd, Ubuntu/Debian)

```bash
sudo apt update && sudo apt install -y nodejs npm
cd /opt && sudo git clone <repo> flightbot   # ya da klasörü scp ile at
cd /opt/flightbot
npm install
npx playwright install --with-deps chromium

sudo cp flightbot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now flightbot
sudo systemctl status flightbot
journalctl -u flightbot -f
```

`flightbot.service` içindeki `User=` ve `WorkingDirectory=` değerlerini kendine göre düzelt.

## Notlar / sınırlar

- Google Flights bazı uçuşlara **"Fiyat yok"** yazıyor; o satırlar atlanıyor (fiyat bilinmediği için karşılaştırılamaz).
- Bir uçuşun kalkış saati okunamazsa **elenmiyor**, işaretlenip yine de raporlanıyor — ucuz bileti kaçırmamak için.
- Fiyatlar Google'ın gösterdiği fiyatlar; havayolunun sitesinde son adımda değişebilir.
- Periyodu 20 dk'nın altına indirip uzun süre çalıştırmak Google'dan geçici rate-limit yiyebilir.
