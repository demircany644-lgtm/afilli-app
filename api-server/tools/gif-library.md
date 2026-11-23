# Ortak Afilli GIF koleksiyonu

Yalnızca güncel `superadmin` rolü toplu yükleme yapar. Rol, her yükleme isteğinde
ve tamamlama işleminde yönetici işlem kilidi altında yeniden doğrulanır.
Dosyalar doğrudan App Storage'a gider; PostgreSQL yalnızca kimlik, sahip,
dosya yolu ve doğrulanan boyutları saklar. Hazır GIF'lerin listesi ve dosyaları
oturum açmış tüm hesaplara açıktır. Tamamlanmamış dosyalar okunamaz.

## Güvenli dosya yayını
- Dosya başına en fazla 5 MB, 2000×2000 piksel, 200 kare ve toplam 20 milyon kare pikseli.
- Gerçek GIF imzası, tam kare çözümleme ve gerçek boyut doğrulanır.
- Değiştirilebilir, 15 dakika geçerli imzalı PUT hedefi `source` dosyasıdır.
  Doğrulanan özgün animasyon ayrı `asset` dosyasına alınır. Sonraki PUT'lar
  yayınlanmış dosyayı değiştiremez; tekrar tamamlama aynı kaydı döndürür.
- Her hesap günde en fazla 100 yükleme başlatabilir. Yeniden denemeler aynı
  istemci kimliğini kullanır, başarılı dosyalar çoğaltılmaz.
- Liste, gönderme ve alıntılar kaydı esas alır. Gönderenin URL, ad, ölçü veya
  sağlayıcı açıklaması doğru kabul edilmez; alanlar sunucudan yeniden üretilir.

## İzin ve süre
Afilli koleksiyonu üçüncü taraf hizmet değildir; KLIPY anahtarı ve onayından
bağımsızdır. KLIPY sekmesi, açıklaması ve geri çekilebilir izni korunur.
Yerel GIF'ler için KLIPY'ye arama veya paylaşım bildirimi gönderilmez.

Ortak koleksiyon uygulamaya aittir; yükleyen hesabın silinmesinde sahip bağlantısı
boşaltılır, resmi varlık silinmez. Özel mesajdaki GIF ve alıntısı gönderimden
yedi gün sonra gizlenir; yazılı açıklama ve diğer metinler korunur. Bu işlem
ortak koleksiyonun aslını silmez. Silinen mesaj iki tarafta da mezar taşı olarak kalır.

## Şema ve yayın
`gif-library.sql` yalnızca yeni tablo ve indeks ekler. Geliştirmede
`pnpm --filter @workspace/api-server exec tsx tools/apply-gif-library.ts`
kullanılabilir; birleştirme sonrası kurulum da aynı geliştirme denetimini çalıştırır.
Üretimde elle SQL, açılış DDL'si veya geliştirme verisi kopyalaması yapılmaz:
Replit **Publish** şema farkını uygular, **üretim verilerinin üzerine yazma kapalı**
tutulur. Yeni GIF tablosu yoksa sunucu sürüm denetimi eksik şemayı açıkça bildirir.
Bu özellik mağazaya kendiliğinden gönderilmez; kurulu uygulamalar için güncel
istemciyi içeren yeni Android/iOS derlemesi gerekir.

Tamamlanmayan kaynak yüklemelerinin zamanlanmış temizliği bu kapsamda değildir;
ortak koleksiyonun dosyalarına özel mesaj temizliği uygulanmaz.

## Kontroller
`pnpm --filter @workspace/api-server run test:gif-library`

Kontroller yalnızca geliştirmede geçici hesap/dosya oluşturur ve kendilerini
temizler. Rol/yükleme, gerçek animasyon, zehirlenmiş kaynak, yeniden deneme,
mesaj/alinti süresi, yazıların korunması ve istemci taslak izolasyonu kapsanır.
