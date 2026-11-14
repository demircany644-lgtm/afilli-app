# Ortam ve hizmet gereksinimleri

**Bu belgede yalnızca ayar isimleri vardır; hiçbir gerçek anahtar veya
ortam değişkeni değeri teslim edilmemiştir.**

Geliştirme ve üretim ayarlarını ayırın. Gerçek değerleri kaynak kod
deposuna, bu belgeye veya ZIP'e eklemeyin. Sunucu anahtarlarını
`EXPO_PUBLIC_` değişkenlerine koymayın: bu değişkenler mobil pakete girebilir.

## Mobil uygulama

| İsim | Kullanımı |
| --- | --- |
| `EXPO_PUBLIC_DOMAIN` | HTTPS API alan adı; mevcut istemci bu ada `https://` ekler. |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Mobil istemcinin doğru ortama ait yayımlanabilir giriş anahtarı. |
| `EXPO_PUBLIC_CLERK_PROXY_URL` | Mevcut giriş vekili kullanılacaksa onun URL'si; mobil yapılandırmada kullanılır. |
| `EXPO_PUBLIC_REPL_ID` | Replit yayınlama altyapısındaki proje tanımı; dış ortamda kullanımı ayrıca değerlendirilir. |

## API sunucusu

| İsim | Kullanımı |
| --- | --- |
| `PORT` | Sunucunun dinleyeceği port. |
| `NODE_ENV` | Geliştirme / üretim çalışma modu. |
| `DATABASE_URL` | PostgreSQL bağlantısı. Yalnızca sunucuda tutulur. |
| `CLERK_SECRET_KEY` | Sunucu giriş doğrulaması; gizlidir. |
| `CLERK_PUBLISHABLE_KEY` | Giriş sisteminin yayımlanabilir anahtarı. |
| `CLERK_PROXY_URL` | Mevcut Replit giriş vekilinin yapılandırması. |
| `PRIVATE_OBJECT_DIR` | Özel dosyaların depolanacağı konum; mevcut kod Replit depolama yan servisini kullanır. |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | Mevcut yapay zekâ entegrasyonunun sunucu adresi. |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | Yapay zekâ erişimi; gizlidir ve mobil uygulamaya konmaz. |
| `AFILLI_BOOTSTRAP_ADMIN_EMAIL` | İsteğe bağlı ilk yönetici tanımı. Gerçek hesap bilgisi teslim edilmedi. |
| `LOG_LEVEL` | İsteğe bağlı günlük seviyesi. |

Bu tablo, kaynakta bulunan temel çalışma gereksinimlerini özetler.
Test betiklerindeki yardımcı değişkenler ve Replit'in otomatik sağladığı
değişkenler, üretim yapılandırması olarak kopyalanmamalıdır.

## Hizmetlerin taşınması

- Mevcut giriş sistemi Replit tarafından yönetilen Clerk kullanıyor.
  Bu paket kimlik doğrulama ayarlarını, hesaplarını veya kullanıcılarını dışarı aktarmaz;
  bir giriş sistemi geçişi yapılmadı.
- PostgreSQL şema kaynakları dahildir, canlı veri ve erişim bilgileri dahil değildir.
- Dosya depolama ve yapay zekâ bağlantılarının Replit dışındaki sunucularda
  aynı şekilde çalışacağı varsayılmamalıdır.
- Mobil uygulama sunucuya ihtiyaç duyar; yalnızca telefon paketinin üretilmesi
  çalışan bir üretim ortamı kurulduğu anlamına gelmez.
- Gerekli gerçek değerler yalnızca uygulama sahibinin yetkili, güvenli
  yapılandırma akışıyla sağlanmalıdır; geliştiriciye düz metin anahtar göndermeyin.
