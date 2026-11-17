# Android açılış hatası: eksik Clerk yapılandırması

Telefondan alınan hata: `@clerk/expo: Clerk keys are missing from your environment`.
Bu hata, Google ile girişten veya boş bir kullanıcı kaydından değil,
Android paketine giriş yapılandırmasının eklenmemesinden kaynaklanır.

## Bu değişiklik ne yapar?

- Clerk de uygulamanın kök hata sınırının içine alındı. Eksik yapılandırmanın
  React hatası, korumasız biçimde uygulamayı kapatmak yerine mevcut hata
  ekranında Türkçe açıklanır. Bu bir misafir oturumu veya doğrulama atlatması değildir.
- Yerel Android/iOS derlemesinin `eas-build-post-install` aşaması,
  gerekli istemci ayarlarını değerlerini yazdırmadan kontrol eder.
- Production profili açıkça `production` ortamını seçer.
- Kitaplar, hesaplar, taslaklar, alt menü ve mevcut doğrulama kuralları değiştirilmedi.

## Yeni Android paketini hazırlamadan önce

Expo'daki mevcut Afilli projesinin **Environment variables** bölümünde,
**production** ortamında şunları ayarla:

| Değişken | Gereken değer |
| --- | --- |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Canlı API ile aynı Clerk Production uygulamasının publishable key değeri. Geliştirme anahtarı değil, `pk_live_` türü olmalı. |
| `EXPO_PUBLIC_DOMAIN` | `afilli-homepage-design.replit.app` — yalnızca yayımlanmış API alan adı, `https://` veya `/api` ekleme. |

Alan adı 2026-11-17 tarihinde Replit'in yayın bilgisiyle doğrulandı.
İleride yayın alan adı değişirse bu değeri yeniden doğrula.

Anahtarı sohbet, ekran görüntüsü, GitHub veya kaynak dosyasına yapıştırma.
Replit'te mevcut çalışma alanı ayarının bulunması, aynı ayarın harici Expo
derleme ortamına geçtiği anlamına gelmez. Replit'in yönettiği geliştirme ve
üretim hesapları ayrıdır; anahtarları elle değiştirme veya yeni bir Clerk
uygulaması oluşturma. Gereken, mevcut canlı sistemin istemci yapılandırmasıdır.
Bu depoda anahtar yoktur ve bu değişiklik Expo hesabındaki ortamı güncellemez.

`CLERK_SECRET_KEY` sunucuya özeldir. Asla `EXPO_PUBLIC_` değişkenine koyma.
Yönetilen proxy ayarlarını da tahminen değiştirme.

## Yayına geçiş sınırı

Yalnızca GitHub'da birleştirmek kurulu uygulamayı düzeltmez. Doğru ortam
ayarlarıyla yeni imzalı Android paketi hazırlanıp Play Console dahili testine
yüklenmelidir. Sürüm kodu, Play Console'a önceden yüklenen en büyük koddan yüksek
olmalıdır. Yeni paketi mevcut uygulamanın üstüne güncelleme olarak kur;
taslakları korumak için uygulamayı kaldırma veya verilerini silme.

Kaynak testleri ve web önizlemesi gerçek Android başlangıç testinin yerine geçmez.
Bu değişiklik yeni AAB üretildiği, Play'e yüklendiği veya telefonda doğrulandığı
anlamına gelmez.
