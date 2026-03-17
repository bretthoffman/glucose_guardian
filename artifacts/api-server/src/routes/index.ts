import { Router, type IRouter } from "express";
import healthRouter from "./health";
import glucoseRouter from "./glucose";
import insulinRouter from "./insulin";
import foodRouter from "./food";
import cgmRouter from "./cgm";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/glucose", glucoseRouter);
router.use("/insulin", insulinRouter);
router.use("/food", foodRouter);
router.use("/cgm", cgmRouter);

export default router;
