# Afilli — Kaynak Kod Teslim Paketi

## Önemli

Bu ZIP, **Google Play Console'a doğrudan yüklenebilen bir uygulama değildir**.
İmzalı Android App Bundle (.aab) içermez. Android derlemesini hazırlayacak
geliştiriciye kaynak kod teslim etmek için oluşturulmuştur.

Replit'in mevcut mobil yayınlama akışı Google Play için AAB üretimini
desteklemiyor. Bu teslim sırasında Android derlemesi, imzalama, mağazaya
yükleme veya GitHub'a gönderim yapılmadı.

## İçindekiler

- `kaynak/artifacts/afilli`: Expo / React Native mobil uygulama ve yerel görseller.
- `kaynak/artifacts/api-server`: API sunucusu ve testler.
- `kaynak/lib`: Ortak istemci, API tanımları, doğrulama şemaları,
  veritabanı şemaları ve yapay zekâ sunucu kodu.
- `kaynak/scripts`, `kaynak/docs`: Projedeki yardımcı betikler ve teknik belgeler.
- `kaynak/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`:
  Çalışma alanı ve kilitlenmiş bağımlılık tanımları.
- `ANDROID_EKSIKLER.md`: Android sürümü ve mağaza teslimi için kontrol listesi.
- `ORTAM_GEREKSINIMLERI.md`: Değerleri paylaşılmayan ortam değişkenleri ve servisler.
- `DOGRULAMA.json`: Bu teslim sırasında yapılan kontroller ve yapılmayan testler.
- `DOSYA_LISTESI_SHA256.json`: Kaynak dosyaları, boyutları ve SHA-256 özetleri.

## Dışarıda bırakılanlar

Gerçek ortam değişkeni değerleri, `.env` dosyaları, sertifikalar,
imzalama anahtarları, Git geçmişi, Replit çalışma alanı ayarları,
Agent konuşma/bellek dosyaları, yüklenen referans belgeler,
veritabanı yedekleri, kullanıcı yüklemeleri, günlükler, derleme çıktıları
ve `node_modules` dahil edilmedi.

Bu bir veri yedeği değildir. Mevcut hesapları, kullanıcıların kitaplarını,
fotoğraflarını veya ses kayıtlarını başka bir ortama taşımaz.
Kaynak kod içindeki statik örnek içerikler korunmuştur.

## Geliştirici için başlangıç

1. ZIP'i açın; terminalde `kaynak` klasörüne geçin.
2. Kök `package.json` dosyasındaki pnpm sürümünü kullanın.
3. Bağımlılıkları `pnpm install --frozen-lockfile` ile kurun.
4. Önce ortak kütüphaneleri hazırlayın: `pnpm run typecheck:libs`.
5. Kontrol edin:
   - `pnpm --filter @workspace/afilli run typecheck`
   - `pnpm --filter @workspace/api-server run typecheck`
6. Sonraki adımlar için iki kontrol listesini okuyun. Gerçek erişim
   değerlerini ZIP'e yazmayın; güvenli ortam ayarları üzerinden sağlayın.

**Taşınabilirlik uyarısı:** Bu, mevcut Replit çalışma alanının kaynak teslimidir;
bağımsız Android derleme projesine dönüştürülmüş değildir. Başlatma betikleri,
kimlik doğrulama vekili ve dosya depolama bazı Replit servislerine bağlıdır.
`pnpm-workspace.yaml` içinde Replit/Linux odaklı platform kısıtlamaları bulunur.
Farklı bir işletim sistemi veya derleme ortamında bunların uyumluluğu ayrıca
değerlendirilmelidir. Bu teslimde bağımlılıklar veya çalışan uygulama değiştirilmedi.

## Kontrollerin kapsamı

Mobil uygulama ve API sunucusunun TypeScript kontrolleri geçti.
ZIP bütünlüğü, dosya özetleri, çalışma alanı bağımlılıklarının kaynakta
bulunması ve yerel görsellerin pakete girmesi kontrol edildi.
Hassas dosya adları ve bilinen anahtar kalıpları için paketleme kontrolü yapıldı;
bu, tam bir güvenlik denetimi değildir.

Android derlemesi, temiz bir dış ortam kurulumu, fiziksel cihaz testi,
Google Play ön incelemesi ve üretim servislerine bağlantı bu teslimde
doğrulanmadı. Kaynak kod kontrollerinin geçmesi, yayın onayı anlamına gelmez.

Resmî Replit açıklaması:
https://docs.replit.com/features/artifact-types/building-mobile-apps
