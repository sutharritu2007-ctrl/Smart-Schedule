import express from "express";
import {
  createSlot,
  deleteSlot,
  getImportedTodayTimetable,
  getImportedWeeklyTimetable,
  getImportedTimetableOptions,
  getSelectedImportedTimetable,
  getTodayTimetable,
  getWeeklyTimetable,
  updateSlot
} from "../controllers/timetable.controller.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

router.get("/today", protect, getTodayTimetable);
router.get("/weekly", protect, getWeeklyTimetable);
router.get("/imported/today", protect, getImportedTodayTimetable);
router.get("/imported/options", protect, getImportedTimetableOptions);
router.get("/imported/selected", protect, getSelectedImportedTimetable);
router.get("/imported/weekly", protect, getImportedWeeklyTimetable);
router.post("/", protect, createSlot);
router.put("/:id", protect, updateSlot);
router.delete("/:id", protect, deleteSlot);

export default router;
