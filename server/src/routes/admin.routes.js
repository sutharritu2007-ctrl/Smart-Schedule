import express from "express";
import {
  createSchedule,
  deleteSchedule,
  getAdminSummary,
  listSchedules,
  updateSchedule
} from "../controllers/admin.controller.js";
import { generateTimetable, saveGeneratedTimetable } from "../controllers/scheduler.controller.js";
import {
  analyzeWhatIfScenario,
  applyWhatIfScenario,
  getWhatIfOptions,
  listWhatIfScenarios,
  rejectWhatIfScenario
} from "../controllers/whatIf.controller.js";
import { protect, requireAdmin } from "../middleware/auth.js";
import asyncHandler from "../utils/asyncHandler.js";

const router = express.Router();

router.use(protect, requireAdmin);

router.get("/summary", asyncHandler(getAdminSummary));
router.get("/schedules", asyncHandler(listSchedules));
router.get("/what-if/options", asyncHandler(getWhatIfOptions));
router.get("/what-if", asyncHandler(listWhatIfScenarios));
router.post("/what-if", asyncHandler(analyzeWhatIfScenario));
router.post("/what-if/:id/apply", asyncHandler(applyWhatIfScenario));
router.post("/what-if/:id/reject", asyncHandler(rejectWhatIfScenario));
router.post("/timetable/generate", asyncHandler(generateTimetable));
router.post("/timetable/save-generated", asyncHandler(saveGeneratedTimetable));
router.post("/schedules", asyncHandler(createSchedule));
router.put("/schedules/:id", asyncHandler(updateSchedule));
router.delete("/schedules/:id", asyncHandler(deleteSchedule));

export default router;
