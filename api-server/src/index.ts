import app from "./app";
import { logger } from "./lib/logger";
import { bootstrapAdministrator } from './lib/admin-bootstrap';
import { getWriterCleanupHealth, recordWriterCleanupAlertTransition } from './lib/writer-cleanup-health';
import { assertAuthReleaseReady } from './lib/auth-release';
import { cleanDeletedAccountMedia } from './lib/admin-account-delete';
import { assertBookCommunitySchema } from './lib/book-community-schema';
import { assertDirectMessageSchema } from './lib/direct-messages';
import { assertGifLibrarySchema } from './lib/gif-library';
import { assertPremiumSchema } from './lib/premium';
import { assertAccountAppealsSchema } from './lib/account-appeals';
import { purgeDirectPhotoQueue, sweepExpiredDirectMedia } from './lib/direct-media';

// Do not accept production traffic with an incomplete legacy-account transition.
await assertAuthReleaseReady();
if (process.env.NODE_ENV === 'production') {
  await assertBookCommunitySchema();
  await assertDirectMessageSchema();
  await assertGifLibrarySchema();
  await assertPremiumSchema();
  await assertAccountAppealsSchema();
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  let cleaningAccountMedia = false;
  const cleanAccountMedia = async () => {
    if (cleaningAccountMedia) return;
    cleaningAccountMedia = true;
    try { await cleanDeletedAccountMedia(); }
    catch { logger.warn({ warning: 'account_media_cleanup_unavailable' }, 'Hesap görsel temizliği çalıştırılamadı'); }
    finally { cleaningAccountMedia = false; }
  };
  void cleanAccountMedia();
  setInterval(() => { void cleanAccountMedia(); }, 60_000).unref();
  let cleaningDirectMedia = false;
  const cleanDirectMessageMedia = async () => {
    if (cleaningDirectMedia) return;
    cleaningDirectMedia = true;
    try {
      await sweepExpiredDirectMedia();
      await purgeDirectPhotoQueue();
    } catch {
      logger.warn({ warning: 'direct_media_cleanup_unavailable' }, 'Özel mesaj medyası temizliği yeniden denenecek');
    } finally { cleaningDirectMedia = false; }
  };
  void cleanDirectMessageMedia();
  setInterval(() => { void cleanDirectMessageMedia(); }, 60_000).unref();
  // Read-only warning, not a cleanup job or a scheduler.
  void getWriterCleanupHealth().then(async health => {
    try {
      const result = await recordWriterCleanupAlertTransition(health.warnings);
      if (result.transition === 'alert') {
        logger.warn({ writerCleanup: health }, 'Yazar temizliği işletmen denetimi gerektiriyor');
      } else if (result.transition === 'recovered') {
        logger.info({ warning: 'writer_cleanup_recovered' }, 'Yazar temizliği uyarıları giderildi');
      }
    } catch {
      // Keep the existing status log useful if the additive alert-state table
      // has not reached this environment yet; never block API startup.
      if (health.warnings.length) logger.warn({ writerCleanup: health }, 'Yazar temizliği işletmen denetimi gerektiriyor');
      logger.warn({ warning: 'cleanup_alert_state_unavailable' }, 'Temizlik uyarısı kaydedilemedi; durum şeması eşitlemesini denetleyin');
    }
  }).catch(() => {
    logger.warn({ warning: 'cleanup_monitoring_unavailable' }, 'Yazar temizliği durumu okunamadı; şema ve bağlantıyı denetleyin');
  });
  void bootstrapAdministrator().catch((error: unknown) => {
    logger.error({ errorType: error instanceof Error ? error.name : 'Unknown' }, 'İlk yönetici kurulumu tamamlanamadı; yönetici işlemleri kapalı kalır');
  });
});
