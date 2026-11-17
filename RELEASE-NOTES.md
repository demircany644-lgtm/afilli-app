# 1.1.1

Eksik giriş yapılandırmasının açılış hatası, kök hata sınırında karşılanır.
Android/iOS derlemesi eksik istemci ayarlarını paketleme öncesinde kontrol eder.
Bu korumalar üretim ayarlarının yerine geçmez; doğru ayarlarla yeni AAB ve cihaz testi gerekir.

Android sürüm kodu 3 olarak hazırlandı. Play Console'da 3 veya daha yüksek bir kod kullanıldıysa bu değer artırılmalıdır.

# 1.1.0

Profilde sosyal medya bağlantıları artık sadece küçük ikon olarak görünüyor.

## Doğrulama ve dağıtım

- Profilde yalnızca eklenmiş kişisel hesapların ikonları gösterilir.
- Kendi profilinde ikon düzenlemeye, ziyaretçi profilinde doğrulanmış adrese gider.
- Yeni `facebook_url` ve `x_url` alanları geliştirme veritabanına eklendi.
- Yönetilen Replit üretim veritabanına şema ve API değişiklikleri desteklenen Publish akışıyla uygulanmalıdır. Yalnızca Android uygulamasını güncellemek sunucuyu güncellemez.
- Android sürüm kodu 2 olarak hazırlandı. Play Console'da 2 daha önce kullanıldıysa yeni derlemeden önce daha yüksek bir sürüm kodu seçilmelidir.
- Bu kaynak değişikliği yeni bir imzalı AAB oluşturulduğu veya Google Play'e gönderildiği anlamına gelmez.
