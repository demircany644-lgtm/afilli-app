import { Router, type IRouter } from 'express';
import { GetStoreCatalogResponse, GetMyStoreCartResponse, AddStoreCartItemBody,
  AddStoreCartItemResponse, UpdateStoreCartItemBody, UpdateStoreCartItemResponse,
  RemoveStoreCartItemResponse, GetMyStoreOrdersResponse, CreateStoreOrderResponse,
  GetAdminStoreOrdersResponse, DecideAdminStoreOrderBody, DecideAdminStoreOrderResponse,
  GetAdminStoreSettingsResponse, UpdateAdminStoreSettingsBody, UpdateAdminStoreSettingsResponse } from '@workspace/api-zod';
import { route, requirePerson, parse, uuid, fail } from '../lib/community';
import { adminActor, adminPage, adminWrite, audit, reasonText } from '../lib/admin';
import { addCartItem, adminOrders, adminStoreSettings, cartFor, catalog, createOrder, decideOrder,
  myOrders, removeCartItem, setStoreActive, updateCartItem } from '../lib/store-orders';

const router: IRouter = Router();

router.get('/store/catalog', route(async (_req, res) => {
  res.json(GetStoreCatalogResponse.parse(await catalog()));
}));
router.get('/store/cart', route(async (req, res) => {
  const actor = await requirePerson(req);
  res.json(GetMyStoreCartResponse.parse(await cartFor(actor.id)));
}));
router.post('/store/cart/items', route(async (req, res) => {
  const actor = await requirePerson(req), input = parse(AddStoreCartItemBody, req.body);
  res.json(AddStoreCartItemResponse.parse(await addCartItem(actor.id, input.productId)));
}));
router.patch('/store/cart/items/:productId', route(async (req, res) => {
  const actor = await requirePerson(req), input = parse(UpdateStoreCartItemBody, req.body);
  if (typeof req.params.productId !== 'string' || req.params.productId.length > 80) return fail(400, 'Geçersiz ürün.');
  res.json(UpdateStoreCartItemResponse.parse(await updateCartItem(actor.id, req.params.productId, input.quantity)));
}));
router.delete('/store/cart/items/:productId', route(async (req, res) => {
  const actor = await requirePerson(req);
  if (typeof req.params.productId !== 'string' || req.params.productId.length > 80) return fail(400, 'Geçersiz ürün.');
  res.json(RemoveStoreCartItemResponse.parse(await removeCartItem(actor.id, req.params.productId)));
}));
router.get('/store/orders', route(async (req, res) => {
  const actor = await requirePerson(req);
  res.json(GetMyStoreOrdersResponse.parse(await myOrders(actor.id)));
}));
router.post('/store/orders', route(async (req, res) => {
  const actor = await requirePerson(req);
  res.status(201).json(CreateStoreOrderResponse.parse(await createOrder(actor.id)));
}));
router.get('/admin/store-orders', route(async (req, res) => {
  await adminActor(req);
  const { offset } = adminPage(req.query);
  res.json(GetAdminStoreOrdersResponse.parse(await adminOrders(offset)));
}));
router.post('/admin/store-orders/:id/decision', route(async (req, res) => {
  const id = uuid(req.params.id), input = parse(DecideAdminStoreOrderBody, req.body), reason = reasonText(input.reason);
  const result = await adminWrite(req, false, async (db, actor) => {
    const decided = await decideOrder(db, actor.id, id, input.decision, reason);
    await audit(db, actor.id, `store.order.${input.decision}`, 'store_order', id, reason, decided);
    return decided;
  });
  res.json(DecideAdminStoreOrderResponse.parse(result));
}));
router.get('/admin/store-settings', route(async (req, res) => {
  await adminActor(req);
  res.json(GetAdminStoreSettingsResponse.parse(await adminStoreSettings()));
}));
router.put('/admin/store-settings', route(async (req, res) => {
  const input = parse(UpdateAdminStoreSettingsBody, req.body), reason = reasonText(input.reason);
  const result = await adminWrite(req, false, async (db, actor) => {
    const before = await adminStoreSettings();
    const after = await setStoreActive(db, actor.id, input.active);
    await audit(db, actor.id, 'store.settings.update', 'store_settings', 'singleton', reason,
      { before: before.active, after: after.active });
    return after;
  });
  res.json(UpdateAdminStoreSettingsResponse.parse(result));
}));

export default router;
