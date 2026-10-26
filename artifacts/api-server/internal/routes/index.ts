import { Router, type IRouter } from "express";
import healthRouter from "./health";
import glucoseRouter from "./glucose";
import insulinRouter from "./insulin";
import foodRouter from "./food";
import cgmRouter from "./cgm";
import chatRouter from "./chat";
import predictRouter from "./predict";
import doctorRouter from "./doctor";
import doctorTrialRouter from "./doctor-trial";
import labsRouter from "./labs";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/glucose", glucoseRouter);
router.use("/insulin", insulinRouter);
router.use("/food", foodRouter);
router.use("/cgm", cgmRouter);
router.use("/chat", chatRouter);
router.use("/predict", predictRouter);
router.use("/labs", labsRouter);
// Mounted before /doctor so the pass routes never pass through the doctor-session guards.
router.use("/doctor/trial", doctorTrialRouter);
router.use("/doctor", doctorRouter);

export default router;
