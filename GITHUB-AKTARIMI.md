# Afilli 1.2.3 — inceleme dalı

Bu dal mevcut main (88f4bb074813b2aac3b7c8de6137345b6d849a4a) üzerine hazırlandı. Ana dal ve canlı uygulama değiştirilmedi.
Android paket kimliği ve mevcut Expo proje bağlantısı korundu. Sürüm kodu 8.

## Kontroller
- pnpm sürümü: pnpm@10.26.1
- pnpm install --frozen-lockfile
- pnpm run typecheck
- pnpm --filter @workspace/api-server run typecheck
- node --test tests/native-auth-env.test.mjs

Clerk anahtarı artık istenmez. EXPO_PUBLIC_DOMAIN yalnızca güncel ve uyumlu API sunucusunu göstermeli.
Bu dal AAB değildir; mağazaya gönderim veya üretim veritabanı değişikliği yapmaz.
Canlı API ve eski hesapların doğrulanmış geçişi tamamlanmadan bu kaynağı yayımlamayın.
Eski kurulumun üzerine güncelleyerek taslakları koruyun; uygulama verilerini silmeyin.
Önceki sürüme ait DOGRULAMA.json ve DOSYA_LISTESI_SHA256.json yeni dalı doğrulamaz.

## Bilerek kaldırılan eski kaynaklar
Yeni uygulamada kullanılmayan Clerk proxy ara katmanı, kişisel Facebook/X bağlantı
yardımcısı ve ona ait eski test kaldırıldı. Geçmişleri Git geçmişinde korunur.
Diğer mevcut dosyalar korunmuştur.
