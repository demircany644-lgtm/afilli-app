import { Router, type IRouter } from 'express';
import {
  GetAccountAppealConfigResponse,
  GetMyAccountAppealResponse,
  VerifyAccountAppealPurchaseBody,
  VerifyAccountAppealPurchaseResponse,
} from '@workspace/api-zod';
import { limitAuth } from '../lib/accounts';
import { route, parse, requirePerson } from '../lib/community';
import { accountAppealConfig, accountAppealSelf, verifyAndCreateAccountAppeal } from '../lib/account-appeals';

const router: IRouter = Router();

router.get('/account-appeals/config', route(async (req, res) => {
  await requirePerson(req);
  res.json(GetAccountAppealConfigResponse.parse(await accountAppealConfig()));
}));

router.get('/account-appeals/me', route(async (req, res) => {
  const actor = await requirePerson(req);
  res.json(GetMyAccountAppealResponse.parse(await accountAppealSelf(actor.id)));
}));

router.post('/account-appeals/verify', route(async (req, res) => {
  const actor = await requirePerson(req);
  const input = parse(VerifyAccountAppealPurchaseBody, req.body);
  await limitAuth(req, 'account-appeal-verify', actor.id, 8);
  const result = await verifyAndCreateAccountAppeal(actor.id, input);
  res.status(result.created ? 201 : 200).json(VerifyAccountAppealPurchaseResponse.parse(result.appeal));
}));

export default router;
