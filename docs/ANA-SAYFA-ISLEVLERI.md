# Afilli — referans Ana Sayfa ve işlevler

Bu çalışma mevcut Expo uygulamasını günceller; ayrı bir maket veya ikinci
uygulama oluşturmaz.

## Ana Sayfa

- Krem `#FDF8EE` zemin, beyaz ince çerçeveli kartlar ve üç sütunlu düzen.
- Afilli Önerileri, Çok Okunanlar ve Popüler Kitaplar altında istenen dokuz
  örnek kitap; eski katalog ve kitap kimlikleri korunur.
- Kapaklar uygulamaya paketlenen fotoğraflardır; örnek kitap ayrıntılarında
  örnek içerik oldukları açıklanır. Fotoğraf kaynakları
  `assets/images/home/SOURCES.md` içindedir.
- Başlık düğmeleri arama, mesaj ve profile; dört hap düğme mevcut Mağazam,
  Dergi, Bültenler ve Özel ekranlarına gider.
- Her `Tümü` bağlantısı ilgili seçkiyi açar. Arama kitap adı, yazar, takma ad
  ve türe göre anında filtreler. Gerçek yayınlanmış topluluk kitapları da
  aynı keşif sayfasında API üzerinden görünür.
- Sabit beş düğmeli alt menü normal akışta yer ayırır. Kitap Yaz düğmesi
  siyah, beyaz halkalı ve beyaz tüylüdür. Ayarlara erişim korunur; çark yoktur.

## Kitaplık ve yazma

- Kitap ayrıntıları, örnek bölümler ve okuma ekranı gerçek rotalardır.
- `Kitaplığıma Ekle`, okumaya başlanmamış kitapları da Kitaplarım'a ekler.
- Kitaplık, önceki okuma konumlarıyla kaydedilen kitapların birleşimidir.
  Mevcut hesaba bağlı cihaz kaydı kullanılır; bu çalışma cihazlar arası
  kitaplık eşitlemesi eklemez.
- Kitaplıktan kaldırma onay ister ve yalnızca o kitabın raf kaydıyla okuma
  konumunu kaldırır. Yazılan kitaplar, diğer raf kayıtları ve taslaklar
  değiştirilmez.
- Mevcut kapak seçimi, tür, açıklama, bölüm ekleme, yerel/bulut taslak kaydı
  ve yazılmış kitap listesi yeniden yazılmadan korunur.

## Örnekler ve gerçek mesajlar

- Gerçek mesajlaşmanın API'si, erişim kontrolleri ve gönderim kuyruğu korunur.
- Mesajlar'daki `Örnek sohbetler` ayrı bir deneme alanıdır. Gerçek kişilere
  gönderim veya sahte çevrimiçi/okundu bilgisi üretilmez.
- Deneme mesajları kullanıcı ve sohbet bazında ayrı cihaz anahtarlarında
  saklanır. Kayıt tamamlanmadan metin temizlenmez; bozuk kaydın üstüne boş
  sohbet yazılmaz. Oturum değişiminde ekranın yerel durumu yeniden oluşturulur.
- Mağazam'da satın alma içermeyen, açıkça örnek olarak etiketlenmiş bir vitrin
  vardır. Bülten örnek arşivi açık başlar; Dergi ve Özel örnekleri korunur.
- Abonelik, kimlik doğrulama ve bildirim yetkilendirmeleri atlanmaz.

## Teslim sınırı

Telefon boyutundaki tarayıcı kontrolünde kitaplığa ekleme → yeniden yüklemede
korunma → örnek bölümü okuma → taslak kaydetme → kitaplıktan kaldırmayı
iptal/onaylama → taslağın korunması ve örnek sohbetin yeniden açıldığında
korunması doğrulandı. Seçki bağlantısı ve Şiir araması da doğrulandı.
Gerçek cihazın galeri/kamera seçicisi bu tarayıcı testiyle doğrulanmış sayılmaz.

Değişiklikler Replit geliştirme kaynağındadır. Bu çalışma canlı sunucuyu
değiştirmez, eski hesapları silmez, GitHub'a aktarım yapmaz ve APK/AAB
oluşturmaz. Android JavaScript dışa aktarımı native kurulum veya Play
yayını değildir. Önceki e-posta/giriş geçişinin canlı yayın koşulları
`EMAIL-AUTH-GECISI.md` içinde ayrıca açıklanır.
