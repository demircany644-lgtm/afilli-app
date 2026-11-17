# 1.2.1 — kapalı test için yerel kaynak hazırlığı

Android paket adı `com.afilli.app` korunarak sürüm adı 1.2.1, sürüm kodu 5
olarak hazırlandı. Profilde yalnızca yönetici tarafından ayarlanmış ortak
Instagram bağlantısı gösterilir; yönetim paneli ve kendi giriş sistemi de bu
kaynakta bulunur.

Bu işlem **imzalı AAB üretmez veya Google Play'e göndermez**. Harici GitHub
`main` dalı hâlâ eski kaynak ve sürüm kodunu kullanıyor; önce güncel kaynak
güvenle eşlenmeli. Canlı API'nin de bu sürümün sözleşmesiyle uyumlu olarak
yayımlanması ve mevcut hesapların güvenli geçişinin doğrulanması gerekir.
Eski uygulama verilerini veya telefondaki taslakları silerek güncelleme yapma.

# 1.2.0 — kaynak hazırlığı, henüz mağaza sürümü değil

Clerk ve Google girişi yerine Afilli’nin sunucusunda e-posta, takma ad ve şifre ile
giriş hazırlanmıştır. Oturumlar iptal edilebilir; Android’de cihazın güvenli
deposunda, web’de HttpOnly çerezde tutulur. Şifreler scrypt ile hashlenir.
Eski hesaplar doğrulanmış kimlik eşleştirmesiyle, kimlikleri değiştirilmeden taşınır.
Doğrulanmış e-posta göndereni ve üretim hesap geçişi tamamlanmadan canlıya alınmamalıdır.
Bu kaynak değişikliği yeni AAB veya gerçek Android cihaz testi anlamına gelmez.

# 1.1.1

Eksik giriş yapılandırmasının açılış hatası, kök hata sınırında karşılanır.
Android/iOS derlemesi eksik istemci ayarlarını paketleme öncesinde kontrol eder.
Bu korumalar üretim ayarlarının yerine geçmez; doğru ayarlarla yeni AAB ve cihaz testi gerekir.

# 1.1.0

Profilde sosyal medya bağlantıları artık sadece küçük ikon olarak görünüyor.
