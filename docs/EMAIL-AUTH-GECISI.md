# Afilli’nin kendi giriş sistemine geçişi

## Durum ve sınırlar

- Uygulama ve API çalışma zamanında Clerk ve Google girişi kaldırılmıştır.
- Yeni kayıt e-posta, takma ad ve şifre ile yapılır; başarılı kayıt Ana Sayfayı açar.
- Şifreler sunucuda scrypt ile hashlenir. Parolalar cihazda saklanmaz.
- Android oturum sırrı SecureStore’da; tarayıcı oturumu HttpOnly, Secure çerezde saklanır.
- Oturum süresi 90 gündür; çıkış ve şifre yenileme sunucuda oturumu iptal eder.
- Açılışta bağlantı kontrolü süreyle sınırlıdır; bağlantı yok diye uygulama kapanmaz.
  Android’de daha önce güvenli depoya kaydedilmiş hesap çevrimdışı açılabilir;
  yeni giriş/kayıt internet ve sunucu kontrolü gerektirir.
- Geliştirme ortamındaki dört eski kimlik doğrulanmış e-postalarıyla eşleştirilmiştir.
  Kitapların, taslakların veya kullanıcıların kimlikleri yeniden yazılmamıştır.
- **Üretim verisi taşınmamıştır. Yeni AAB oluşturulmamıştır.**
- **Resend bağlantısı hazırdır ama doğrulanmış gönderen alanı henüz yoktur.**
  Gerçek şifre e-postası ve canlı hesap geçişi henüz hazır değildir.

## Eski hesapları koruma

Eski kullanıcıların parolaları yeni veritabanına kopyalanmış sayılmaz.
Güvenilir eski kimlik deposundaki doğrulanmış birincil e-posta, mevcut kullanıcı
kimliği ve yönetici rolü birlikte taşınır. Kullanıcı daha sonra e-postasına gelen
tek kullanımlık kodla yeni şifre belirler. Yalnız e-posta yazmak içerik sahipliği vermez.

Tek seferlik araç `api-server/tools/migrate-auth.ts` dosyasındadır
(Replit çalışma alanında `artifacts/api-server/tools/migrate-auth.ts`).
Varsayılanı salt okunur ön kontroldür; `--apply` olmadan kayıt yazmaz.
Eski kimlik sağlayıcısına yalnızca bu geçiş aracı erişir; uygulama bunu çağırmaz.
Eski sağlayıcı hesaplarını silmez, parolaları okumaz ve kişisel bilgileri yazdırmaz.
Eski kimlik anahtarının test/canlı türü hedef ortamla eşleşmek zorundadır.

Doğrulanmamış e-posta, belirsiz eşleştirme, iki faktörlü koruma, engelli hesap veya
eşleşmeyen içerik sahibi varsa otomatik geçiş durur. Bunlar atlanarak veya başka
bir yeni hesaba içerik bağlanarak tamamlanmış sayılmamalıdır.
Tekrar çalıştırma yeni belirlenmiş parolayı veya sonradan değişmiş yerel rolü ezmez.

## Canlıya alma öncesi zorunlu işlemler

1. Doğrulanmış gönderim adresini hazırla. Gmail gibi başkasına ait alan adları
   Resend’de uygulamanın üretim gönderen alanı olarak doğrulanamaz.
   Test göndericisini tüm kullanıcılara çalışır gibi kullanma.
2. Sunucunun üretim ortamında `AFILLI_AUTH_EMAIL_FROM` değerini doğrulanmış adrese
   ayarla; alan adı gerçekten doğrulandıktan sonra
   `AFILLI_AUTH_EMAIL_VERIFIED=true` kullan. Bağlantı yetkisini istemciye koyma.
3. Mevcut üretim kullanıcı/içerik envanterini ve geri dönüş yöntemini doğrula.
   Geliştirme kimliklerini üretime kopyalama. Geçiş sırasında eski kayıt yazımlarını
   durduracak kontrollü bakım planı uygula.
4. `api-server/tools/auth-schema.sql` içindeki yalnızca yeni tabloları ekleyen
   şemayı inceleyip üretime uygula. `prepare-auth-schema.ts` yalnız geliştirme
   içindir; üretim veritabanını otomatik seçmez.
5. Üretim kimlik deposu ve aynı üretim veritabanı üzerinde ön kontrol yap.
   Yazılı geçiş için ayrıca `AFILLI_AUTH_MIGRATION_APPROVED=true` gereklidir.
   Araç gönderen ayarı yoksa üretim geçişini reddeder. İnsan onayı ve doğru
   üretim bağlantısı olmadan uygulanmamalıdır.
6. Eski kimlikler eşleşmeden yeni kayıtları açma. Mevcut veritabanında geçiş
   tamamlanmamışsa kayıt endpoint’i kapalı kalır. Üretim sunucusu, gönderen veya
   kimlik eşleştirmesi eksikse trafik kabul etmeden açık bir hata ile durur;
   bu korumayı kaldırıp mevcut hizmetin üzerine yayınlama.
7. API ve mobil istemciyi birlikte geçirecek sürüm planı yap. Bu değişikliği
   sadece telefona yüklemek yayımlanmış eski API’yi değiştirmez.
8. Android istemci için gereken yapılandırma `EXPO_PUBLIC_DOMAIN` değeridir:
   API’nin yayımlanmış ana makine adı, protokol veya yol eklemeden verilmelidir.
   Artık Clerk istemci anahtarı gerekmez. Mağaza sürüm kodu mevcut en yüksek
   koddan büyük olmalıdır; kaynakta önerilen değer 4’tür.
9. Yeni imzalı Android paketini gerçek cihazda kurulum, güncelleme, çıkış/giriş,
   çevrimdışı açılış ve eski taslakların korunması açısından doğrula.
   JS dışa aktarımı veya tarayıcı testi bu testin yerine geçmez.

## Gizlilik ve kurtarma

Anahtarlar, kodlar, oturum sırları ve kimlik listeleri kaynak koda, GitHub’a veya
sohbete konmaz. Kullanıcılara uygulamayı kaldırmalarını ya da cihaz verisini
silmelerini söyleme: çevrimdışı taslaklar kaybolabilir.

Eski Clerk ayarını tamamlamaya yönelik önceki Android dalı bu yeni giriş
sistemiyle karıştırılmamalıdır. Bu çalışma henüz harici GitHub kaynağına
eşlenmemiştir; eski depodan derleme yapılması yeni giriş sistemini içermez.
