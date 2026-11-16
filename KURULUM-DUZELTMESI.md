# Afilli — GitHub paket kurulumu düzeltmesi

## Bu paket nedir?

`demircany644-lgtm/afilli-app` deposunun incelenen sürümü temel alınarak
hazırlanan düzeltilmiş kaynak koddur. AAB veya APK değildir.
Düzeltmeler GitHub'da `fix/pnpm-workspace-install` dalında sunulmaktadır.
Ana dala otomatik birleştirme veya yayınlama yapılmamıştır.

## Neler düzeltildi?

- `pnpm-lock.yaml` başına yanlışlıkla yazılmış terminal komutu temizlendi.
- Kilit dosyası pnpm 10.26.1 ile, mevcut yedi çalışma alanı paketi için yeniden oluşturuldu.
- Ana `package.json` dosyasına `"packageManager": "pnpm@10.26.1"` eklendi.
- Çalışma alanı listesi mevcut klasörlere göre düzeltildi; klasörler taşınmadı.
- Windows ve macOS paketlerinin kurulmasını engelleyen platform dışlamaları kaldırıldı.
  Güvenlik amaçlı sürüm düzeltmeleri ve minimum paket yaşı ayarı korundu.
- TypeScript ve API üretim yolları mevcut klasör yapısıyla eşleştirildi.
- Depoda eksik olan API dışa aktarma dosyası ve ses hizmeti durum tipi tamamlandı.
- Gizli dosyaları, kurulu paketleri ve çıktıları dışlayan `.gitignore` eklendi.
- Uygulama ekranları, kitaplar, hesap işlemleri ve uygulama kimlikleri değiştirilmedi.

Kilit dosyası yeniden çözümlendiği için, paketlerin tanımlı sürüm aralıkları
içindeki bazı kesin sürümleri önceki kilit dosyasından farklı olabilir.

## Windows'ta ne yapacağım?

1. ZIP'e sağ tıklayıp **Tümünü ayıkla** seçeneğini kullanın.
2. Yeni, boş bir klasöre çıkarın. Eski proje klasörünüzü silmeyin.
3. İçindeki `afilli-app-duzeltilmis` klasörünü açın.
4. Burada `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` ve `app` görünmelidir.
5. Windows için Node.js LTS kurulu olmalıdır.
6. Bu klasördeki `WINDOWS-KURULUM.cmd` dosyasına çift tıklayın.

Bu dosya komut penceresini kendisi açar, doğru klasöre geçer, pnpm 10.26.1
ile kilitli paket kurulumunu ve TypeScript kontrollerini çalıştırır.
Bir hata olursa pencere kapanmadan önce çıktıyı okuyabilirsiniz.
Uygulamayı derlemez, başlatmaz, GitHub'a göndermez ve ücretli işlem başlatmaz.

Elle çalıştırmayı tercih ederseniz bu klasörde terminal açıp sırayla yazın:

```text
npx --yes pnpm@10.26.1 install --frozen-lockfile
npx --yes pnpm@10.26.1 run typecheck
npx --yes pnpm@10.26.1 --filter @workspace/api-server run typecheck
```

Bu komutlar dosya içeriklerine yapıştırılmaz. Var olan kod silinmez.
Yeni oluşturulan kilit dosyası kullanıldığı için `--no-frozen-lockfile` gerekmez.

## GitHub'a nasıl aktarılır?

Düzeltme dalı GitHub'a gönderilmiştir. Ana dalı güncellemek için dalın
değişikliklerini inceleyip bir pull request üzerinden birleştirmek gerekir.
Bu birleştirme kullanıcı onayına bırakılmıştır.

Aşağıdaki adımlar, ZIP kopyasını bilgisayarından ayrıca uygulamak isterseniz
kullanılabilir. Düzeltme dalını kullanıyorsanız aynı dosyaları tekrar
yüklemeniz gerekmez.

GitHub Desktop kullanıyorsanız:

1. `demircany644-lgtm/afilli-app` deposuna yazma izni olan hesapla giriş yapın.
2. Depoyu bilgisayarınıza klonlayın ve son değişiklikleri alın.
3. Düzeltmeler için ayrı bir dal oluşturun; ana dalın üzerine doğrudan yazmayın.
4. ZIP'teki `afilli-app-duzeltilmis` klasörünün **içeriğini**, klonladığınız
   deponun ana klasörüne kopyalayın. Aynı adlı dosyaları değiştirme işlemi,
   yalnızca bu düzeltme dosyalarını uygulamak içindir. Önce değişiklikleri gözden geçirin.
5. ZIP'in üst klasörünü deponun içine ek bir alt klasör olarak koymayın.
6. `node_modules`, `.env`, anahtarlar ve kurulum çıktıları gönderilmemelidir.
7. Değişiklikleri inceleyip düzeltme dalına kaydedin ve gönderin.

GitHub deposunda bu paketten sonra yeni değişiklikler yapıldıysa dosyaları
körlemesine değiştirmeyin; yeni değişiklikleri de koruyarak birleştirin.

## Doğrulananlar ve sınırlar

Linux ortamında, Node v24.22.1 ve pnpm 10.26.1 ile:

- Boş `node_modules` durumundan `pnpm install --frozen-lockfile`: başarılı.
- Kurulumdan önce/sonra kilit dosyasının SHA-256 özeti aynı kaldı.
- Ortak kütüphanelerin ve mobil uygulamanın TypeScript kontrolü: başarılı.
- API sunucusunun TypeScript kontrolü: başarılı.
- Android, iOS ve web JavaScript dışa aktarımı: başarılı.
- Git farkında boşluk/hatalı satır kontrolü: başarılı.

Expo sürüm denetimi bazı paketler için güncel yama sürümü/uyum uyarıları verdi.
Bu paket bu uyarıları gizlemez ve yeni bir SDK'ya geçiş yapmaz.
Paket kurulumunda iki bağımlılığın betikleri pnpm'in izin listesi dışında
kaldığı için çalıştırılmadı; bu izinler otomatik genişletilmedi.

Windows/macOS üzerinde gerçek kurulum, fiziksel cihaz, oturum açma,
canlı sunucu bağlantısı, imzalama, AAB/APK derlemesi veya mağazaya gönderim
doğrulanmadı. JavaScript çıktısı alınması bu adımların yerine geçmez.
API/kimlik doğrulama ve diğer hizmetler için mevcut güvenli ortam
yapılandırması ayrıca gereklidir; gizli değerler bu pakete eklenmedi.

Eski teslim raporları depo geçmişinden korunmuştur. Bu düzeltmenin kapsamı
için bu belgeyi esas alın.
