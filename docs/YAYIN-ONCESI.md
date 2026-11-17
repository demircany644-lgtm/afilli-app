# Sunucuyu yeni Android test sürümüne hazırlama

Bu belge yayın veya üretim verisi değişikliği yapmaz. Android AAB değildir.

## Yayın öncesi

1. Geliştirmede `pnpm --filter @workspace/api-server run typecheck` ve
   `pnpm --filter @workspace/api-server run test:release` kontrollerini çalıştır.
   İkinci komut gerçek e-posta göndermez.
2. Geliştirme şemasıyla yayın şeması farkını incele. Beklenen değişiklikler
   yönetim işlem geçmişi tablosu, içerik denetimi sütunları, isteğe bağlı
   Instagram bağlantısı ve `superadmin` rolüdür. Oturum indeksi ve mevcut
   hesap ilişkileri korunmalıdır.
3. Üretimde profil/hesap eşleşmelerini ve geçiş kaydını salt okunur kontrol et.
   Tamamlanmış aktarımı yeniden çalıştırma; hesapları veya cihaz verilerini silme.
4. Bağlı Gmail göndereninin üretimden erişilebilir olduğunu doğrula. Sunucu
   açılışı bu kontrolü yapar; eşleşmeyen veya erişilemeyen gönderenle yeni
   sürüm trafik kabul etmez. Gerçek teslimat, ayrıca izinli bir gönderimle
   doğrulanmalıdır; sentetik test başarıları teslimat kanıtı değildir.
5. İlk üst düzey yönetici hesabı ayrı bir adımdır: sadece e-posta yazılması
   yetki kazandırmaz. İstenen hesap mevcut değilse önce normal kayıt ve
   doğrulanmış sahiplik, ardından yetkili rol atama işlemi gerekir.

## Kullanıcının yayın adımı

- Yayın ekranında yeni sunucu kaynağını ve şema farkını gözden geçir.
- **Üretim verilerini geliştirme verileriyle değiştirme seçeneğini kullanma.**
- Tablo/sütun silme veya beklenmeyen yeniden adlandırma uyarısı çıkarsa dur.
- Şema değişiklikleri yalnızca onaylanan Yayınla akışıyla uygulanır; ayrı bir
  SQL, sunucu başlangıç işlemi veya derleme komutuyla üretim şemasını değiştirme.
- Üretim e-posta bağlantısı doğrulanamıyorsa yayını zorlamak için açılış
  güvenlik kontrolünü kaldırma.

## Yayından sonra

- `/api/healthz` yanıtı başarılı olmalı.
- `/api/auth/session` oturumsuz istekte `user: null` dönmeli.
- `/api/admin/overview` oturumsuz istekte 401/403 dönmeli; 404 olmamalı.
- `/api/social-settings` içinde `instagramUrl` bulunmalı; yönetici kaydetmediyse
  null olmalı ve profilde simge görünmemeli.
- İzinli gerçek şifre kurtarma e-postasını, mevcut kullanıcı girişini ve
  kitapların korunmasını doğrula. Bunlar tamamlanmadan Android kapalı test
  güncellemesini hazır kabul etme.
