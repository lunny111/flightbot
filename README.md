# Ucuz Bilet Takip Botu

Belirlediğin rotaları düzenli aralıklarla tarar, fiyat eşiğinin altına düşen bileti Discord'a webhook ile bildirir.

Aranan rotalar, tarihler ve fiyat eşiği repoda **tutulmaz** — çalışma anında `CONFIG_JSON` secret'ından okunur.

## Nereden veri çekiyor

İki kaynağı birden tarayıp en ucuzunu alıyor:

**Skiplagged** — Cloudflare korumasının arkasında, düz HTTP isteği `403` döner. Bot gerçek bir tarayıcı açıp challenge'ı geçiyor, sonra **sayfanın içinden `fetch`** ile API'yi çağırıyor; aynı oturumun çerezleri kullanıldığı için istekler geçiyor. Tek sayfa yüklemesiyle bütün aramalar yapılıyor.

Bu API'nin değerli tarafı: her uçuş için OTA fiyatlarını ayrı ayrı veriyor — FlightNetwork, Gotogate, Mytrip, Kiwi, FAST ve **Skyscanner**. Yani Skyscanner'ın botunu kırmadan Skyscanner fiyatına ulaşılıyor. Fiyatlar USD cent cinsinden geliyor, TL kuru `currency.php`'den alınıyor.

**Google Flights** — DOM'dan okunuyor. Skiplagged genelde daha ucuz çıkıyor ama her zaman değil, o yüzden ikisi de taranıyor.

**Skyscanner (doğrudan)** — denendi, olmuyor. Headless Chromium, gerçek Chrome ve görünür tarayıcı; üçü de "Are you a person or a robot?" duvarına takıldı. Aşmak residential proxy ve sürekli bakım isteyen bir silahlanma yarışı olurdu; Skiplagged üzerinden zaten Skyscanner fiyatı geldiği için gerek kalmadı.

## Kurulum

```bash
npm install
npx playwright install --with-deps chromium
cp config.example.json config.json    # düzenle
```

## Çalıştırma

```bash
node bot.js            # sonsuz döngü
node bot.js --once     # tek tur
```

Config'i değiştirmeden geçici override:

```bash
ALERT_THRESHOLD=16000 LOG_THRESHOLD=17000 INTERVAL_MIN=5 node bot.js --once
```

Webhook `DISCORD_WEBHOOK` ortam değişkeninden de okunur ve config'e göre önceliklidir.

## config.json

| Alan | Anlamı |
|---|---|
| `alertThresholdTRY` | Bu fiyatın altına düşerse Discord'a bildirim gider |
| `logThresholdTRY` | Bu fiyatın altındakiler sadece log'a yazılır |
| `intervalMinutes` | Kontrol periyodu |
| `mentionEveryone` | `@everyone` etiketi atılsın mı |
| `searches[].from` | Google Flights için kalkış (şehir adı da olur) |
| `searches[].fromCodes` | Skiplagged için kalkış havalimanı kodları; birden fazla yazılabilir |
| `searches[].to` | Varış havalimanı kodu |
| `searches[].minDepartureTime` | O tarih için en erken kalkış saati, `"18:00"` gibi; yoksa `null` |
| `headless` | Sunucuda `true` |

## Tekrar bildirim mantığı

`state.json` görülen uçuşları tutar. Aynı uçuş için tekrar bildirim sadece yeni görüldüyse, fiyatı bir öncekinden daha da düştüyse ya da üzerinden 6 saat geçtiyse gönderilir — böylece aynı bilet her turda spam'lenmez.

## GitHub Actions ile çalıştırma

Repo'da hazır workflow var; `schedule` ile periyodik, `workflow_dispatch` ile elle tetiklenir.

İki secret gerekiyor:

```bash
gh secret set DISCORD_WEBHOOK --body "https://discord.com/api/webhooks/..."
gh secret set CONFIG_JSON < config.json
```

Public repo'da Actions dakikası ücretsiz ve sınırsız. Bilinmesi gerekenler:
- Zamanlanmış işler "best effort" çalışır; yoğun saatlerde 10-30 dk gecikebilir, bazen atlanır.
- Public repo'da 60 gün commit atılmazsa GitHub zamanlanmış işleri durdurur, mail atıp yeniden aktive etmeni ister.
- Hesapta ödeme sorunu varsa public repo'da bile işler çalışmaz.

## Sunucuda çalıştırma (systemd)

```bash
npm install && npx playwright install --with-deps chromium
sudo cp flightbot.service /etc/systemd/system/
sudo systemctl enable --now flightbot
journalctl -u flightbot -f
```

`flightbot.service` içindeki `User=` ve `WorkingDirectory=` değerlerini kendine göre düzelt.

## Sınırlar

- Google Flights bazı uçuşlara "Fiyat yok" yazıyor; o satırlar atlanıyor.
- Kalkış saati okunamayan uçuş elenmiyor, işaretlenip yine de raporlanıyor — ucuz bileti kaçırmamak için.
- Geçici ağ hatalarında arama artan beklemeyle 3 kez tekrar denenir.
- Fiyatlar arama sitelerinin gösterdiği fiyatlar; satıcının sitesinde son adımda değişebilir.
