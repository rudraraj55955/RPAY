import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { mapDbError } from "./lib/apiError";
import fs from "fs";
import path from "path";

const app: Express = express();
app.set("trust proxy", 1);

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
app.use(cors());
app.use(express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// TEMPORARY: deployment patch download — remove after VPS deploy
app.get("/api/_deploy/rasokart-payout-patch.tgz", (req: Request, res: Response) => {
  const filePath = "/tmp/rasokart-payout-patch.tgz";
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "patch file not found" });
    return;
  }
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", "attachment; filename=rasokart-payout-patch.tgz");
  res.sendFile(path.resolve(filePath));
});

// Global error handler — maps DB/unknown errors to safe structured JSON;
// never forwards raw SQL, column names, stack traces, or secrets to clients.
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled route error");
  const { status, body } = mapDbError(err);
  const requestId = (req as any).id as string | undefined;
  res.status(status).json({ ...body, ...(requestId ? { requestId } : {}) });
});

export default app;
