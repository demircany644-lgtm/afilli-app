# Google Play sürümü için eksikler ve kontrol listesi

Bu liste bir yayın onayı değildir. Uygulamaya veya hesaplara değişiklik yapılmadı.

## Kaynakta doğrulanan durum

- Uygulama adı: **Afilli**.
- Expo uygulama sürümü: **1.0.0** (`artifacts/afilli/app.json`).
- `android` ayarı şu anda boş: açık bir `android.package` ve
  `android.versionCode` tanımlı değil.
- Uygulama simgesi ve kaynakta kullanılan yerel görseller pakette.
- İmzalı `.aab`, imzalama anahtarı veya Google Play erişim bilgisi pakette yok.
- İstemci ve sunucunun TypeScript kontrolleri geçti.

## Android sürümü hazırlanmadan önce

- [ ] Google Play geliştirici hesabının uygulama sahibine ait olduğunu doğrula.
- [ ] Uygulama daha önce mağazada yayımlandıysa mevcut Android uygulama
  kimliğini ve imzalama sürekliliğini doğrula. Mevcut kimliği rastgele değiştirme.
- [ ] İlk yayınsa kalıcı Android paket kimliğini uygulama sahibiyle belirle.
- [ ] Android sürüm kodunu belirle; önceki sürüm varsa onun üzerinde olmalı.
- [ ] Kullanılacak Android derleme ortamında mevcut Expo ve React Native
  bağımlılıklarının uyumluluğunu doğrula. Sürümleri gelişigüzel düşürme.
- [ ] Paket hazırlanırken geçerli Google Play hedef Android API ve diğer
  teknik gereksinimlerini Console'dan doğrula.
- [ ] Yükleme anahtarının sahipliğini, güvenli saklanmasını ve
  Play App Signing ayarlarını tamamla. Anahtarları kaynak ZIP'ine koyma.
- [ ] Gerçek imzalı AAB üretimini Android derleme ortamında tamamla.

## Üretim servisleri

- [ ] Mobil uygulamanın kullanacağı erişilebilir HTTPS API alan adını doğrula.
  Geliştirme önizleme adresini kalıcı üretim adresi kabul etme.
- [ ] Üretim giriş/kayıt ayarlarını, yönlendirmeleri ve sunucudaki
  oturum doğrulamasını gerçek Android cihazda dene.
- [ ] Veritabanı şemasını, erişim izinlerini ve yedeklemeyi doğrula.
  ZIP'te veri dökümü yoktur; mevcut kullanıcı verisi taşınmış sayılmaz.
- [ ] Kitap kapağı, profil ve bülten fotoğrafı yüklemelerinin üretim
  depolama sistemiyle çalıştığını doğrula. Mevcut sunucu depolama kodu
  Replit yan servisine bağlıdır; başka sunucuya taşıma ayrıca ele alınmalı.
- [ ] Sesli yazma için sunucu hizmetini, kullanıcı onayını, mikrofon
  iznini ve kayıtların saklama/silme davranışını gerçek cihazda doğrula.
- [ ] Kullanılacaksa ücretli özellikleri ve abonelikleri Google Play
  politikalarına uygun ödeme ve sunucu doğrulamasıyla doğrula.

## Mağaza bilgileri ve son cihaz testleri

- [ ] Mağaza açıklaması, destek iletişimi ve gerekli görselleri hazırla.
- [ ] Gerçek uygulama davranışına uygun gizlilik politikası ve
  Veri Güvenliği beyanını hazırla.
- [ ] Hesap açılabiliyorsa hesap/veri silme koşullarını doğrula.
- [ ] İçerik derecelendirmesi, hedef kitle ve kullanıcı üretimli içerik
  koşullarını, şikâyet/engelleme ve denetim davranışlarını doğrula.
- [ ] Kamera, fotoğraf ve mikrofon izinlerinin yalnızca ihtiyaç halinde
  istendiğini ve reddetme durumlarının doğru işlendiğini doğrula.
- [ ] Giriş, kitap yazma/kaydetme, çevrimdışı kalma, uygulamanın kapanması,
  yeniden açılması ve son bölümün kurtarılması akışlarını Android'de dene.
- [ ] Alt menünün sabit kaldığını, son kitabı örtmediğini ve beş butonun
  gerçek sayfalara gittiğini cihazda doğrula.
- [ ] Google Play hesabının gerektirdiği test aşamalarını Console'da kontrol et;
  önce uygun test kanalında imzalı sürümü dene.

Bu teslim sırasında hiçbir kutu tamamlanmış kabul edilmedi.
Gerçek AAB ve mağaza/cihaz testleri olmadan uygulama “Google Play'e hazır”
olarak nitelendirilmemelidir.
