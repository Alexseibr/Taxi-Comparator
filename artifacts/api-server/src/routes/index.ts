import { Router, type IRouter } from "express";
import healthRouter from "./health";
import taxiRouter from "./taxi";
import tariffGridRouter from "./tariff-grid";
import telegramBotRouter from "./telegram-bot";

const router: IRouter = Router();

router.use(healthRouter);
router.use(taxiRouter);
router.use(tariffGridRouter);
router.use(telegramBotRouter);

export default router;
