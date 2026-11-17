import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { allowedOrigin, authenticatedUserId, authMiddleware } from './lib/auth-session';

const app: Express = express();
app.set('trust proxy', 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ credentials: true, origin: (origin, cb) => cb(null, !origin || allowedOrigin(origin)) }));
app.use(authMiddleware);
// Larger manuscript/audio bodies remain authenticated and bounded.
app.use(['/api/writer-books', '/api/writer-voice'], (req, res, next) => {
  if (req.method !== 'GET' && !authenticatedUserId(req)) { res.status(401).json({ error: 'Devam etmek için giriş yap.' }); return; }
  next();
});
app.use('/api/writer-books', express.json({ limit: '32mb' }));
app.use('/api/writer-voice', express.json({ limit: '16mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
const bodyErrors: ErrorRequestHandler = (error, _req, res, next) => {
  if (error?.type === 'entity.too.large') { res.status(413).json({ error: 'Kitap kaydı veya ses dosyası çok büyük. Yerel kaydını silmeden boyutu azaltıp yeniden dene.' }); return; }
  if (error?.type === 'entity.parse.failed') { res.status(400).json({ error: 'Gönderilen kayıt okunamadı. Yerel kaydını silmeden yeniden dene.' }); return; }
  next(error);
};
app.use(bodyErrors);

export default app;
