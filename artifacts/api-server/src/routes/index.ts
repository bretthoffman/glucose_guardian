import { Router, type IRouter } from "express";
import healthRouter from "./health";
import glucoseRouter from "./glucose";
import insulinRouter from "./insulin";
import foodRouter from "./food";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/glucose", glucoseRouter);
router.use("/insulin", insulinRouter);
router.use("/food", foodRouter);

export default router;
