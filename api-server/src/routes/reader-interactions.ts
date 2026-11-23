import { Router, type IRouter } from 'express';
import { SetReaderLikeBody, ReportWriterCommentBody, ResolveReaderReportBody,
  GetReaderChapterResponse, SetReaderLikeResponse, ReportWriterCommentResponse, GetReaderReportsResponse,
  ResolveReaderReportResponse, GetReaderReportsQueryParams } from '@workspace/api-zod';
import { route, requirePerson, parse, uuid, viewer, transaction } from '../lib/community';
import { adminActor, adminWrite } from '../lib/admin';
import { readerChapter, readerContext, readerLike } from '../lib/reader-interactions';
import { reportComment, reportPage, resolveReport } from '../lib/reader-reports';

const router: IRouter = Router();
router.get('/authored-books/:id/chapters/:chapterId/interactions', route(async (req, res) => {
  const context = await readerContext(uuid(req.params.id), uuid(req.params.chapterId));
  res.json(GetReaderChapterResponse.parse(await readerChapter(context, viewer(req))));
}));
router.put('/authored-books/:id/chapters/:chapterId/interactions', route(async (req, res) => {
  const actor = await requirePerson(req), book = uuid(req.params.id), chapter = uuid(req.params.chapterId), input = parse(SetReaderLikeBody, req.body);
  res.json(SetReaderLikeResponse.parse(await transaction(db => readerLike(db, book, chapter, actor.id, input.liked, input.paragraphId ?? null))));
}));
router.post('/writer-comments/:id/reports', route(async (req, res) => {
  const actor = await requirePerson(req), id = uuid(req.params.id), input = parse(ReportWriterCommentBody, req.body);
  res.json(ReportWriterCommentResponse.parse(await transaction(db => reportComment(db, actor.id, id, input))));
}));
router.get('/admin/reader-reports', route(async (req, res) => {
  await adminActor(req);
  const query = parse(GetReaderReportsQueryParams, req.query);
  res.json(GetReaderReportsResponse.parse(await reportPage(query.status ?? 'pending', query.cursor)));
}));
router.patch('/admin/reader-reports/:id', route(async (req, res) => {
  const id = uuid(req.params.id), input = parse(ResolveReaderReportBody, req.body);
  res.json(ResolveReaderReportResponse.parse(await adminWrite(req, false, (db, actor) => resolveReport(db, actor.id, id, input.action))));
}));
export default router;
