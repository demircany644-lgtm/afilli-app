import { Router, type IRouter } from "express";
import healthRouter from "./health";
import bulletinRouter from './bulletins';
import profileRouter from './profiles';
import messageRouter from './messages';
import directMediaRouter from './direct-media';
import writerRouter from './writer';
import discoveryRouter from './discovery';
import bookCommunityRouter from './book-community';
import writerMediaRouter from './writer-media';
import writerToolsRouter from './writer-tools';
import authRouter from './auth';
import adminRouter from './admin';

const router: IRouter = Router();

router.use(authRouter);
router.use(adminRouter);
router.use(healthRouter);
router.use(bulletinRouter);
router.use(profileRouter);
router.use(messageRouter);
router.use(writerRouter);
router.use(discoveryRouter);
router.use(bookCommunityRouter);
router.use(writerMediaRouter);
router.use(directMediaRouter);
router.use(writerToolsRouter);

export default router;
