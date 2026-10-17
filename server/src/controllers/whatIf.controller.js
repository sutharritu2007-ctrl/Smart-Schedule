import mongoose from "mongoose";
import ClassSchedule from "../models/ClassSchedule.js";
import WhatIfScenario from "../models/WhatIfScenario.js";
import ScheduleException from "../models/ScheduleException.js";
import Notification from "../models/Notification.js";
import { FIXED_VENUES } from "../data/venues.js";
import { normalizeRoomName } from "../utils/normalizeRoom.js";
import { overlaps, parseTimeToMinutes } from "../utils/time.js";

const WEEKDAYS_BY_UTC_INDEX = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
export const dayOfWeekForDate = (date) => WEEKDAYS_BY_UTC_INDEX[date.getUTCDay()];

const facultyTokens = (value) => String(value || "")
  .split(/[\/,;]+/)
  .map((token) => token.replace(/\s*\(Group\s*\d+\)\s*/gi, " ").trim())
  .filter(Boolean);
const hasFaculty = (value, target) => facultyTokens(value).some((name) => name.toLowerCase() === target.toLowerCase());
const timeOf = (value) => {
  if (typeof value !== "string" || !/^\d{1,2}:\d{2}$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  if (hour > 23 || minute > 59) return null;
  const minutes = parseTimeToMinutes(String(value || ""));
  return minutes !== null && minutes >= 0 && minutes < 1440 ? minutes : null;
};
const validDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
};
const parseGroupSet = (slot) => {
  if (!/lab/i.test(slot.roomNo || "")) return [];
  const text = [slot.facultyName, slot.rawText, slot.courseName].filter(Boolean).join(" ");
  return [...new Set([...text.matchAll(/Group\s*(\d+)/gi)].map((match) => Number(match[1])))];
};
const sectionsConflict = (left, right) => {
  if (left.batch !== right.batch) return false;
  const leftGroups = parseGroupSet(left);
  const rightGroups = parseGroupSet(right);
  return !(leftGroups.length === 1 && rightGroups.length === 1 && leftGroups[0] !== rightGroups[0]);
};
const startsAndEnds = (slot) => ({ start: timeOf(slot.startTime), end: timeOf(slot.endTime) });
const inDisruptionWindow = (slot, start, end) => {
  const range = startsAndEnds(slot);
  return range.start !== null && range.end !== null && range.end > range.start && overlaps(range.start, range.end, start, end);
};
const assignment = (slot) => ({
  dayOfWeek: slot.dayOfWeek,
  startTime: slot.startTime,
  endTime: slot.endTime,
  courseCode: slot.courseCode,
  courseName: slot.courseName,
  facultyName: slot.facultyName,
  roomNo: slot.roomNo,
  batch: slot.batch,
  semester: slot.semester,
  program: slot.program
});

const LEGACY_BATCH_OVERLAP_CONFLICT = "The affected batch or section has another overlapping class at this time.";
const isOnlyLegacyBatchOverlap = (change) => (
  Boolean(change.proposed) &&
  Array.isArray(change.conflicts) &&
  change.conflicts.length > 0 &&
  change.conflicts.every((conflict) => conflict === LEGACY_BATCH_OVERLAP_CONFLICT)
);
const hasCompleteLegacyReplacement = (scenario) => (
  scenario.affectedSchedules.length > 0 &&
  scenario.affectedSchedules.every((change) => change.proposed && (change.resolved || isOnlyLegacyBatchOverlap(change)))
);

export const getWhatIfOptions = async (req, res) => {
  const [schedules, rooms] = await Promise.all([
    ClassSchedule.find({ isCancelled: false }).select("facultyName").lean(),
    Promise.resolve(FIXED_VENUES)
  ]);
  const faculty = [...new Set(schedules.flatMap((slot) => facultyTokens(slot.facultyName)))].sort((a, b) => a.localeCompare(b));
  return res.json({ faculty, rooms });
};

export const listWhatIfScenarios = async (req, res) => {
  const scenarios = await WhatIfScenario.find().sort({ createdAt: -1 }).limit(50).lean();
  return res.json({ scenarios });
};

export const analyzeWhatIfScenario = async (req, res) => {
  const { scenarioType, target, date, allDay, startTime, endTime, reason = "", affectedClassIds = [] } = req.body;
  if (!["faculty-absence", "room-maintenance"].includes(scenarioType)) {
    return res.status(400).json({ message: "Choose a supported disruption type." });
  }
  if (typeof target !== "string" || !target.trim() || target.length > 120) {
    return res.status(400).json({ message: "Choose a faculty member or room." });
  }
  const disruptionDate = validDate(date);
  if (!disruptionDate) return res.status(400).json({ message: "Provide a valid disruption date." });
  if (typeof reason !== "string" || reason.length > 500) return res.status(400).json({ message: "Reason must be 500 characters or fewer." });
  if (typeof allDay !== "boolean") {
    return res.status(400).json({ message: "The all-day selection must be an explicit boolean value." });
  }
  if (!Array.isArray(affectedClassIds) || affectedClassIds.length > 100 || affectedClassIds.some((id) => !mongoose.isValidObjectId(id))) {
    return res.status(400).json({ message: "Affected class identifiers are invalid." });
  }

  let windowStart = 0;
  let windowEnd = 1440;
  if (!allDay) {
    windowStart = timeOf(startTime);
    windowEnd = timeOf(endTime);
    if (windowStart === null || windowEnd === null || windowStart >= windowEnd) {
      return res.status(400).json({ message: "Enter a valid start and end time, or select all-day." });
    }
  }

  const dayOfWeek = dayOfWeekForDate(disruptionDate);
  const targetValue = target.trim();
  if (scenarioType === "room-maintenance" && !FIXED_VENUES.some((room) => normalizeRoomName(room.name) === normalizeRoomName(targetValue))) {
    return res.status(400).json({ message: "Choose a room from the registered venue list." });
  }
  const daySchedules = await ClassSchedule.find({ dayOfWeek, isCancelled: false }).lean();
  let affected = daySchedules.filter((slot) => {
    const matchesTarget = scenarioType === "faculty-absence"
      ? hasFaculty(slot.facultyName, targetValue)
      : normalizeRoomName(slot.roomNo) === normalizeRoomName(targetValue);
    return matchesTarget && inDisruptionWindow(slot, windowStart, windowEnd);
  });
  if (affectedClassIds.length) {
    const selectedIds = new Set(affectedClassIds.map(String));
    affected = affected.filter((slot) => selectedIds.has(String(slot._id)));
    if (affected.length !== selectedIds.size) {
      return res.status(400).json({ message: "One or more selected classes do not match this disruption." });
    }
  }

  const allRelevantSchedules = await ClassSchedule.find({ isCancelled: false }).lean();
  const notes = [
    `The stored timetable is a recurring weekly template. This date selects ${dayOfWeek}; approved changes affect the recurring template unless the application is extended with dated schedule overrides.`,
    "Faculty availability and qualifications are inferred from existing timetable assignments; no separate faculty registry is currently modeled."
  ];
  if (scenarioType === "room-maintenance") {
    notes.push("Room capacity and equipment requirements are not stored, so room suitability cannot be verified and room changes cannot be marked conflict-free.");
  }

  const sameCourseRecords = scenarioType === "faculty-absence" && affected.length
    ? await ClassSchedule.find({ courseCode: { $in: [...new Set(affected.map((slot) => slot.courseCode))] }, isCancelled: false })
      .select("courseCode facultyName")
      .lean()
    : [];
  const qualifiedByCourse = new Map();
  sameCourseRecords.forEach((row) => {
    const candidates = qualifiedByCourse.get(row.courseCode) || new Set();
    facultyTokens(row.facultyName).forEach((facultyName) => candidates.add(facultyName));
    qualifiedByCourse.set(row.courseCode, candidates);
  });
  const loadByFaculty = new Map();
  allRelevantSchedules.forEach((slot) => facultyTokens(slot.facultyName).forEach((facultyName) => {
    const key = facultyName.toLowerCase();
    loadByFaculty.set(key, (loadByFaculty.get(key) || 0) + 1);
  }));

  const reservedFaculty = [];
  const reservedRooms = [];
  const snapshots = affected.map((slot) => {
    const conflicts = [];
    let proposed = null;
    if (scenarioType === "faculty-absence") {
      const candidates = [...(qualifiedByCourse.get(slot.courseCode) || [])]
        .filter((candidate) => candidate.toLowerCase() !== targetValue.toLowerCase())
        .sort((a, b) => (loadByFaculty.get(a.toLowerCase()) || 0) - (loadByFaculty.get(b.toLowerCase()) || 0));
      const candidate = candidates.find((name) => {
        const clashes = allRelevantSchedules.some((other) => (
          String(other._id) !== String(slot._id) &&
          other.dayOfWeek === slot.dayOfWeek &&
          inDisruptionWindow(other, timeOf(slot.startTime), timeOf(slot.endTime)) &&
          hasFaculty(other.facultyName, name)
        ));
        return !clashes && !reservedFaculty.some((reserved) => (
          reserved.name.toLowerCase() === name.toLowerCase() &&
          overlaps(reserved.start, reserved.end, slot.startMinutes, slot.endMinutes)
        ));
      });
      if (candidate) {
        const facultyName = facultyTokens(slot.facultyName)
          .map((name) => name.toLowerCase() === targetValue.toLowerCase() ? candidate : name)
          .join(" / ");
        proposed = { ...assignment(slot), facultyName };
        reservedFaculty.push({ name: candidate, start: slot.startMinutes, end: slot.endMinutes });
      } else {
        conflicts.push(`No conflict-free faculty member with an existing ${slot.courseCode} assignment was found. A date-only reschedule cannot be applied safely to the recurring-week model.`);
      }
    } else {
      const sourceRoom = FIXED_VENUES.find((room) => normalizeRoomName(room.name) === normalizeRoomName(slot.roomNo));
      const candidate = FIXED_VENUES.find((room) => {
        if (room.type !== sourceRoom?.type || normalizeRoomName(room.name) === normalizeRoomName(targetValue)) return false;
        if (reservedRooms.some((reserved) => normalizeRoomName(reserved.name) === normalizeRoomName(room.name) && overlaps(reserved.start, reserved.end, slot.startMinutes, slot.endMinutes))) return false;
        return !allRelevantSchedules.some((other) => (
          String(other._id) !== String(slot._id) &&
          other.dayOfWeek === slot.dayOfWeek &&
          normalizeRoomName(other.roomNo) === normalizeRoomName(room.name) &&
          inDisruptionWindow(other, timeOf(slot.startTime), timeOf(slot.endTime))
        ));
      });
      if (candidate) {
        proposed = { ...assignment(slot), roomNo: candidate.name };
        conflicts.push("Room capacity and equipment are unknown; suitability must be verified before this proposal can be applied.");
        reservedRooms.push({ name: candidate.name, start: slot.startMinutes, end: slot.endMinutes });
      } else {
        conflicts.push("No currently unoccupied room of the same registered room type was found.");
      }
    }

    const changesStudentTime = proposed && (
      proposed.dayOfWeek !== slot.dayOfWeek ||
      proposed.startTime !== slot.startTime ||
      proposed.endTime !== slot.endTime
    );
    const batchConflict = changesStudentTime && allRelevantSchedules.some((other) => (
      String(other._id) !== String(slot._id) &&
      other.dayOfWeek === proposed.dayOfWeek &&
      inDisruptionWindow(other, timeOf(proposed.startTime), timeOf(proposed.endTime)) &&
      sectionsConflict(slot, other) &&
      slot.batch === other.batch
    ));
    if (batchConflict) conflicts.push("The affected batch or section has another overlapping class at this time.");

    if (scenarioType === "room-maintenance" && proposed) {
      const roomConflict = allRelevantSchedules.some((other) => (
        String(other._id) !== String(slot._id) &&
        other.dayOfWeek === slot.dayOfWeek &&
        normalizeRoomName(proposed.roomNo) === normalizeRoomName(other.roomNo) &&
        inDisruptionWindow(other, timeOf(slot.startTime), timeOf(slot.endTime))
      ));
      if (roomConflict) conflicts.push("The proposed room has an overlapping scheduled class.");
    }

    return {
      scheduleId: slot._id,
      original: assignment(slot),
      proposed,
      conflicts,
      resolved: Boolean(proposed) && conflicts.length === 0,
      updatedAtSnapshot: slot.updatedAt || null
    };
  });

  if (!affected.length) notes.push("No classes matched the selected faculty/room, date, and time window.");
  notes.push("This is a recurring weekly timetable. Final approval confirms that the proposed change applies to future occurrences of this weekday.");

  const status = snapshots.length && snapshots.every((snapshot) => snapshot.resolved)
    ? "feasible"
    : "conflicts-found";
  const scenario = await WhatIfScenario.create({
    scenarioType,
    target: targetValue,
    disruptionDate,
    allDay: Boolean(allDay),
    startTime: allDay ? "" : startTime,
    endTime: allDay ? "" : endTime,
    reason: reason.trim(),
    applyToWeeklyTemplate: false,
    affectedSchedules: snapshots,
    status,
    analysisNotes: notes,
    createdBy: req.user._id
  });
  return res.status(201).json({ scenario });
};

export const applyWhatIfScenario = async (req, res) => {
  const applyAsBreak = req.body.action === "break" || req.body.action === "leave";
  const notifyStudents = req.body.notifyStudents === true;
  if (req.body.confirm !== true) {
    return res.status(400).json({ message: "Explicit confirmation of the proposed timetable change is required." });
  }
  const session = await mongoose.startSession();
  try {
    let appliedScenario;
    await session.withTransaction(async () => {
      const scenario = await WhatIfScenario.findById(req.params.id).session(session);
      if (!scenario) throw Object.assign(new Error("What-If scenario not found."), { statusCode: 404 });
      if (["applied", "rejected"].includes(scenario.status)) {
        throw Object.assign(new Error(`This scenario is already ${scenario.status}.`), { statusCode: 409 });
      }
      if (scenario.status !== "feasible") {
        const legacyProposalIsSafe = scenario.status === "conflicts-found" && hasCompleteLegacyReplacement(scenario);
        if ((!applyAsBreak && !legacyProposalIsSafe) || (applyAsBreak && !["conflicts-found", "pending-review"].includes(scenario.status))) {
          throw Object.assign(new Error("Reanalyze this scenario or choose the break-and-notify fallback for unresolved classes."), { statusCode: 409 });
        }
      }
      if (applyAsBreak && scenario.status === "feasible") {
        throw Object.assign(new Error("This scenario has valid replacements. Apply the replacement proposal instead."), { statusCode: 409 });
      }
      if (!scenario.affectedSchedules.length) {
        throw Object.assign(new Error("No affected classes were found for this scenario."), { statusCode: 409 });
      }
      if (!applyAsBreak && scenario.affectedSchedules.some((change) => !change.proposed || (!change.resolved && !isOnlyLegacyBatchOverlap(change)))) {
        throw Object.assign(new Error("Unresolved conflicts must be addressed before applying this proposal."), { statusCode: 409 });
      }
      for (const change of scenario.affectedSchedules.filter((entry) => !applyAsBreak && entry.proposed && (entry.resolved || isOnlyLegacyBatchOverlap(entry)))) {
        const update = {};
        if (change.original.facultyName !== change.proposed.facultyName) update.facultyName = change.proposed.facultyName;
        if (change.original.roomNo !== change.proposed.roomNo) update.roomNo = change.proposed.roomNo;
        if (change.original.startTime !== change.proposed.startTime) update.startTime = change.proposed.startTime;
        if (change.original.endTime !== change.proposed.endTime) update.endTime = change.proposed.endTime;
        if (!Object.keys(update).length) continue;
        update.startMinutes = parseTimeToMinutes(change.proposed.startTime);
        update.endMinutes = parseTimeToMinutes(change.proposed.endTime);
        const result = await ClassSchedule.updateOne(
          { _id: change.scheduleId, updatedAt: change.updatedAtSnapshot },
          { $set: update },
          { session }
        );
        if (result.modifiedCount !== 1) {
          throw Object.assign(new Error("A class changed after this proposal was analyzed. Reanalyze the scenario before applying."), { statusCode: 409 });
        }
      }
      if (applyAsBreak) {
        const date = scenario.disruptionDate.toISOString().slice(0, 10);
        const breakCandidates = scenario.affectedSchedules;
        for (const change of breakCandidates) {
          const original = change.original;
          const schedule = await ClassSchedule.findOne({ _id: change.scheduleId, updatedAt: change.updatedAtSnapshot }).session(session).lean();
          if (!schedule) {
            throw Object.assign(new Error("An affected class changed after analysis. Reanalyze before applying the break."), { statusCode: 409 });
          }
          const exists = await ScheduleException.findOne({ scheduleId: change.scheduleId, date }).session(session).lean();
          if (exists) {
            throw Object.assign(new Error("A date-specific exception already exists for one of these classes."), { statusCode: 409 });
          }
          await ScheduleException.create([{
            scheduleId: change.scheduleId,
            scenarioId: scenario._id,
            date,
            dayOfWeek: original.dayOfWeek,
            startTime: original.startTime,
            endTime: original.endTime,
            batch: original.batch,
            semester: original.semester,
            program: original.program,
            courseCode: original.courseCode,
            courseName: original.courseName,
            facultyName: original.facultyName,
            roomNo: original.roomNo,
            reason: scenario.scenarioType === "faculty-absence"
              ? `Faculty leave: ${scenario.target}${scenario.reason ? ` · ${scenario.reason}` : ""}`
              : scenario.reason || `${scenario.target} unavailable`,
            createdBy: req.user._id
          }], { session });
        }
        const affectedBatches = [...new Set(breakCandidates.map((change) => change.original.batch))];
        const courseNames = [...new Set(breakCandidates.map((change) => change.original.courseCode))];
        if (notifyStudents) {
          const eventAt = new Date(`${date}T00:00:00.000Z`);
          const isFacultyLeave = scenario.scenarioType === "faculty-absence";
          const notification = await Notification.create([{
            title: isFacultyLeave ? `Faculty leave: ${scenario.target}` : `Timetable break: ${courseNames.join(", ")}`,
            message: isFacultyLeave
              ? `${scenario.target} is on leave on ${date}. No replacement was available for ${courseNames.join(", ")} in ${affectedBatches.join(", ")}; those classes are cancelled for that date only.${scenario.reason ? ` Reason: ${scenario.reason}` : ""}`
              : `${courseNames.join(", ")} will not be held on ${date} for ${affectedBatches.join(", ")} because no valid replacement was available.${scenario.reason ? ` Reason: ${scenario.reason}` : ""}`,
            audience: "all",
            eventType: "other",
            eventAt,
            expiresAt: new Date(`${date}T23:59:59.999Z`),
            createdBy: req.user._id
          }], { session });
          scenario.notificationId = notification[0]._id;
        }
        scenario.analysisNotes.push(`Date-specific break recorded for ${breakCandidates.length} affected class(es).${notifyStudents ? " Student notification sent." : " No notification was sent."}`);
      }
      scenario.status = "applied";
      scenario.applyToWeeklyTemplate = !applyAsBreak;
      scenario.appliedAt = new Date();
      await scenario.save({ session });
      appliedScenario = scenario.toObject();
    });
    return res.json({ message: "Approved changes applied.", scenario: appliedScenario });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    if (error.code === 20 || /transaction numbers are only allowed|replica set/i.test(error.message || "")) {
      return res.status(503).json({ message: "Applying proposals requires MongoDB transactions; use a replica set deployment." });
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

export const rejectWhatIfScenario = async (req, res) => {
  const scenario = await WhatIfScenario.findOneAndUpdate(
    { _id: req.params.id, status: { $in: ["pending-review", "feasible", "conflicts-found"] } },
    { $set: { status: "rejected", rejectedAt: new Date() } },
    { new: true, runValidators: true }
  );
  if (!scenario) return res.status(404).json({ message: "Open What-If scenario not found." });
  return res.json({ scenario });
};