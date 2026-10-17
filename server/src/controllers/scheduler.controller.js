import mongoose from "mongoose";
import ClassSchedule from "../models/ClassSchedule.js";
import { FIXED_VENUES } from "../data/venues.js";
import { normalizeRoomName } from "../utils/normalizeRoom.js";
import { parseTimeToMinutes } from "../utils/time.js";

const scheduleFields = [
  "source", "program", "semester", "batch", "dayOfWeek", "startTime", "endTime",
  "courseCode", "courseName", "facultyName", "roomNo", "rawText", "isCancelled"
];

const venueByName = new Map(FIXED_VENUES.map((venue) => [normalizeRoomName(venue.name), venue.name]));

export const generateTimetable = async (req, res) => {
  const schedulerUrl = (process.env.SCHEDULER_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 85000);

  try {
    const response = await fetch(`${schedulerUrl}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
      signal: controller.signal
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = result.detail;
      const message = typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((entry) => entry.msg).filter(Boolean).join(" ")
          : "The scheduling service rejected this request.";
      return res.status(response.status === 422 ? 422 : 502).json({
        message
      });
    }
    return res.json(result);
  } catch (error) {
    const message = error.name === "AbortError"
      ? "Timetable generation timed out. Reduce the problem size and try again."
      : "The CP-SAT scheduling service is unavailable. Start the FastAPI service and try again.";
    return res.status(error.name === "AbortError" ? 504 : 503).json({ message });
  } finally {
    clearTimeout(timeout);
  }
};

export const saveGeneratedTimetable = async (req, res) => {
  const { assignments, confirmReplace } = req.body;
  if (!confirmReplace) {
    return res.status(400).json({ message: "Confirm replacement of the existing timetable before saving." });
  }
  if (!Array.isArray(assignments) || assignments.length < 1 || assignments.length > 800) {
    return res.status(400).json({ message: "Provide between 1 and 800 generated sessions." });
  }

  const rows = [];
  for (const assignment of assignments) {
    const roomNo = venueByName.get(normalizeRoomName(assignment.roomNo || ""));
    if (!roomNo) return res.status(400).json({ message: `Unknown room "${assignment.roomNo}".` });
    const row = Object.fromEntries(
      scheduleFields.filter((field) => assignment[field] !== undefined).map((field) => [field, assignment[field]])
    );
    row.roomNo = roomNo;
    row.startMinutes = parseTimeToMinutes(row.startTime);
    row.endMinutes = parseTimeToMinutes(row.endTime);
    row.rawText = row.rawText || `${row.courseCode || ""} ${row.courseName || ""} ${roomNo}`.trim();
    row.source = "generated";
    rows.push(row);
  }

  const { semester, program } = rows[0];
  const batches = [...new Set(rows.map((row) => row.batch))];
  if (!semester || !program || batches.some((batch) => !batch) || rows.some((row) => row.semester !== semester || row.program !== program)) {
    return res.status(400).json({ message: "A save operation must contain one program and semester, and one or more batches." });
  }

  const session = await mongoose.startSession();
  try {
    let saved = [];
    await session.withTransaction(async () => {
      saved = await ClassSchedule.insertMany(rows, { ordered: true, session });
      for (const batch of batches) {
        const savedIds = saved.filter((slot) => slot.batch === batch).map((slot) => slot._id);
        await ClassSchedule.deleteMany({
          batch,
          semester,
          program,
          _id: { $nin: savedIds }
        }, { session });
      }
    });
    return res.status(201).json({
      message: "Generated timetable saved.",
      count: saved.length,
      batches,
      assignments: saved
    });
  } finally {
    await session.endSession();
  }
};