# Afilli 1.2.3 — Android sürüm kodu 8

## Bu sürümde
- En üst yönetici aynı anda birden fazla GIF seçip yayımlayabilir.
- Dosya bazında sonuç, hata ve yeniden deneme vardır; başarılı GIF tekrar yüklenmez.
- Ortak Afilli GIF koleksiyonu tüm oturum açmış kullanıcılarda görünür.
- Ortak koleksiyon KLIPY izni veya anahtarı gerektirmez; KLIPY sekmesi korunur.
- Mesajlardaki yedi günlük GIF süresi, açıklama metni ve silinmiş mesaj davranışı korunur.
- Bültenlerde beş fotoğraflı kaydırmalı galeri bu sürümün kapsamına dahil değildir.

## Güvenli dağıtım sırası
Önce Replit'teki güncel API yayımlanmalıdır. Şema farkı yalnızca yeni `gif_library`
tablosunu, ona ait ilişkiyi ve indeksi ekler. Üretim verilerinin üzerine geliştirme
verisi kopyalanmamalı; mevcut hesaplar, kitaplar ve mesajlar silinmemelidir.
Sonra yeni Android derlemesi mevcut kapalı testin Alpha kanalında kullanılabilir.
Bu kaynak dalı tek başına Google Play'e yayın anlamına gelmez.

Özgün Expo proje kimliği, Android paket kimliği ve imzalama düzeni korunmuştur.
Clerk anahtarı gerekmez; üretim derlemesinde doğrulanmış canlı API alan adını gösteren
`EXPO_PUBLIC_DOMAIN` gereklidir. Kullanıcılar uygulama verilerini temizlemek yerine
mevcut kurulumun üzerine güncellemelidir.

## Doğrulama sınırı
Güncel kaynakta sunucu izinleri/yükleme/mesaj süresi için 51 gerçek API kontrolü,
istemci taslak/yeniden deneme kontrolleri ve tarayıcıda iki hesaplı yükleme-gönderme
akışı geçti. Tarayıcı otomasyonunda dosyalar uygulamanın kendi dosya girdisine
verildi; gerçek Android/iOS galeri seçicisi ve cihazdaki animasyon ayrıca doğrulanmalıdır.
Yerel JavaScript paketlemesi imzalı Android derlemesinin veya Play kabulünün kanıtı değildir.
