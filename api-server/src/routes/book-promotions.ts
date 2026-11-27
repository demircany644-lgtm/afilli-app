import { Router, type IRouter } from 'express';
import {
  GetAdminBookPromotionRequestsQueryParams, GetAdminBookPromotionRequestsResponse,
  GetAdminBookPromotionSettingsResponse, UpdateAdminBookPromotionSettingsBody,
  UpdateAdminBookPromotionSettingsResponse, DecideAdminBookPromotionRequestBody,
  DecideAdminBookPromotionRequestResponse, GetMyBookPromotionResponse, CreateBookPromotionRequestBody,
  CreateBookPromotionRequestResponse, GetPromotedBooksResponse,
} from '@workspace/api-zod';
import { route, parse, requirePerson, uuid } from '../lib/community';
import { adminActor } from '../lib/admin';
import { adminBookPromotionRequests, createBookPromotionRequest, decideBookPromotion,
  getBookPromotionSettings, myBookPromotion, updateBookPromotionSettings } from '../lib/book-promotions';
import { promotedBooks } from '../lib/discovery';

const router: IRouter = Router();

router.get('/discovery/promoted-books', route(async (_req, res) => {
  res.json(GetPromotedBooksResponse.parse(await promotedBooks()));
}));

router.get('/authored-books/:id/promotion', route(async (req, res) => {
  const actor = await requirePerson(req), id = uuid(req.params.id);
  res.json(GetMyBookPromotionResponse.parse(await myBookPromotion(id, actor.id)));
}));
router.post('/authored-books/:id/promotion-requests', route(async (req, res) => {
  const actor = await requirePerson(req), id = uuid(req.params.id);
  const input = parse(CreateBookPromotionRequestBody, req.body);
  const result = await createBookPromotionRequest(id, actor, input);
  res.status(201).json(CreateBookPromotionRequestResponse.parse(result));
}));

router.get('/admin/book-promotion-settings', route(async (req, res) => {
  await adminActor(req);
  res.json(GetAdminBookPromotionSettingsResponse.parse(await getBookPromotionSettings()));
}));
router.put('/admin/book-promotion-settings', route(async (req, res) => {
  const input = parse(UpdateAdminBookPromotionSettingsBody, req.body);
  res.json(UpdateAdminBookPromotionSettingsResponse.parse(await updateBookPromotionSettings(req, input)));
}));
router.get('/admin/book-promotion-requests', route(async (req, res) => {
  const query = parse(GetAdminBookPromotionRequestsQueryParams, req.query);
  res.json(GetAdminBookPromotionRequestsResponse.parse(await adminBookPromotionRequests(req, query.status, query)));
}));
router.post('/admin/book-promotion-requests/:id/decision', route(async (req, res) => {
  const input = parse(DecideAdminBookPromotionRequestBody, req.body);
  res.json(DecideAdminBookPromotionRequestResponse.parse(await decideBookPromotion(req, req.params.id, input)));
}));

export default router;
