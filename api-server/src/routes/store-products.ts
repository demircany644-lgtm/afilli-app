import { Router, type IRouter } from 'express';
import {
  GetAdminStoreProductsResponse, CreateAdminStoreProductBody, CreateAdminStoreProductResponse,
  RequestAdminStoreProductUploadBody, RequestAdminStoreProductUploadResponse,
  CompleteAdminStoreProductUploadResponse,
} from '@workspace/api-zod';
import { route, parse, uuid, fail } from '../lib/community';
import { adminActor, adminWrite, audit } from '../lib/admin';
import { storeProductObject, requestStoreProductUpload, completeStoreProductUpload,
  getAdminStoreProducts, createStoreProduct, productImageIsListed, storeProductUploadUrl } from '../lib/store-products';

const router: IRouter = Router();

router.get('/admin/store-products', route(async (req, res) => {
  await adminActor(req);
  res.json(GetAdminStoreProductsResponse.parse(await getAdminStoreProducts()));
}));

router.post('/admin/store-product-uploads', route(async (req, res) => {
  const input = parse(RequestAdminStoreProductUploadBody, req.body);
  const upload = await adminWrite(req, false, async (db, actor) => {
    const result = await requestStoreProductUpload(db, actor.id, input);
    await audit(db, actor.id, 'store.product-image.upload', 'store_product_upload', result.id,
      'Ürün görseli yüklemesi başlatıldı.', { contentType: input.contentType, size: input.size });
    return result;
  });
  res.json(RequestAdminStoreProductUploadResponse.parse({ ...upload, uploadUrl: await storeProductUploadUrl(upload.id) }));
}));

router.post('/admin/store-product-uploads/:id/complete', route(async (req, res) => {
  const id = uuid(req.params.id);
  const result = await adminWrite(req, false, async (db, actor) => {
    const completed = await completeStoreProductUpload(db, actor.id, id);
    await audit(db, actor.id, 'store.product-image.complete', 'store_product_upload', id,
      'Ürün görseli doğrulandı ve sıkıştırıldı.', completed);
    return completed;
  });
  res.json(CompleteAdminStoreProductUploadResponse.parse(result));
}));

router.post('/admin/store-products', route(async (req, res) => {
  const input = parse(CreateAdminStoreProductBody, req.body);
  const product = await adminWrite(req, false, async (db, actor) => {
    const created = await createStoreProduct(db, actor.id, input);
    await audit(db, actor.id, 'store.product.create', 'store_product', created.id,
      'Yeni mağaza ürünü eklendi.', { category: created.category, name: created.name, priceKurus: created.priceKurus });
    return created;
  });
  res.status(201).json(CreateAdminStoreProductResponse.parse(product));
}));

router.get('/store-product-media/:id', route(async (req, res) => {
  const id = uuid(req.params.id);
  if (!(await productImageIsListed(id))) return fail(404, 'Ürün görseli bulunamadı.');
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const stream = storeProductObject(id, 'asset').createReadStream();
  stream.once('error', () => { if (!res.headersSent) res.status(404).end(); else res.destroy(); });
  res.once('close', () => stream.destroy());
  stream.pipe(res);
}));

export default router;
