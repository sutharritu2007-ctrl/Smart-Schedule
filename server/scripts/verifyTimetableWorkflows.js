import "dotenv/config";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import ClassSchedule from "../src/models/ClassSchedule.js";
import WhatIfScenario from "../src/models/WhatIfScenario.js";
import ScheduleException from "../src/models/ScheduleException.js";
import Notification from "../src/models/Notification.js";
import { FIXED_VENUES } from "../src/data/venues.js";
import { analyzeWhatIfScenario, applyWhatIfScenario, dayOfWeekForDate } from "../src/controllers/whatIf.controller.js";
import { saveGeneratedTimetable } from "../src/controllers/scheduler.controller.js";
import {
  getImportedTimetableOptions,
  getSelectedImportedTimetable
} from "../src/controllers/timetable.controller.js";

const response = () => ({
  code: 200,
  data: null,
  status(code) {
    this.code = code;
    return this;
  },
  json(data) {
    this.data = data;
    return this;
  }
});

const facultyNameFrom = (value) => String(value || "")
  .split(/[\/,;]+/)[0]
  .replace(/\s*\(Group\s*\d+\)\s*/gi, " ")
  .trim();

if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required for timetable integration checks.");
assert.equal(dayOfWeekForDate(new Date("2026-10-19T00:00:00.000Z")), "monday");

await mongoose.connect(process.env.MONGO_URI);
let temporaryScenarioId;
let temporaryScheduleId;
let temporaryExceptionId;
let temporaryNotificationId;
const temporaryExtraScheduleIds = [];
const temporaryGeneratedBatches = ["ZZ INTEGRATION BATCH A", "ZZ INTEGRATION BATCH B"];
try {
  const countBefore = await ClassSchedule.countDocuments({ isCancelled: false });
  const scenariosBefore = await WhatIfScenario.countDocuments({ reason: "Automated integration smoke test" });
  const testRowsBefore = await ClassSchedule.countDocuments({ source: "integration-test" });
  const source = await ClassSchedule.findOne({ isCancelled: false }).lean();
  const facultySource = await ClassSchedule.findOne({ isCancelled: false, facultyName: { $exists: true, $ne: "" } }).lean();
  assert.ok(source, "Expected real timetable records in MongoDB.");
  assert.ok(facultySource, "Expected a timetable row with an assigned faculty member.");

  const user = {
    _id: new mongoose.Types.ObjectId(),
    role: "user",
    batch: source.batch,
    semester: source.semester
  };
  const optionsResponse = response();
  await getImportedTimetableOptions({ user }, optionsResponse);
  assert.ok(optionsResponse.data.batches.length > 0);
  assert.ok(optionsResponse.data.batches.every((scope) => scope.batch === user.batch && scope.semester === user.semester));

  const timetableResponse = response();
  await getSelectedImportedTimetable({
    user,
    query: { program: source.program, semester: source.semester, batch: source.batch }
  }, timetableResponse);
  assert.equal(timetableResponse.code, 200);
  assert.ok(timetableResponse.data.slots.length > 0);
  assert.ok(timetableResponse.data.slots.every((slot) => slot.batch === user.batch && slot.semester === user.semester));

  const deniedResponse = response();
  await getSelectedImportedTimetable({
    user,
    query: { program: source.program, semester: source.semester, batch: "not-authorized" }
  }, deniedResponse);
  assert.equal(deniedResponse.code, 403);

  const weekdayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const targetDay = weekdayNames.indexOf(facultySource.dayOfWeek);
  assert.notEqual(targetDay, -1);
  const disruptionDate = new Date();
  disruptionDate.setUTCDate(disruptionDate.getUTCDate() + ((targetDay - disruptionDate.getUTCDay() + 7) % 7 || 7));
  const scenarioResponse = response();
  await analyzeWhatIfScenario({
    user: { _id: new mongoose.Types.ObjectId(), role: "admin" },
    body: {
      scenarioType: "faculty-absence",
      target: facultyNameFrom(facultySource.facultyName),
      date: disruptionDate.toISOString().slice(0, 10),
      allDay: true,
      reason: "Automated integration smoke test",
      affectedClassIds: [],
      applyToWeeklyTemplate: false
    }
  }, scenarioResponse);
  assert.equal(scenarioResponse.code, 201);
  temporaryScenarioId = scenarioResponse.data.scenario._id;
  assert.ok(scenarioResponse.data.scenario.affectedSchedules.length > 0);
  assert.ok(scenarioResponse.data.scenario.affectedSchedules.every((change) => change.original.dayOfWeek === facultySource.dayOfWeek));
  await WhatIfScenario.deleteOne({ _id: temporaryScenarioId });
  temporaryScenarioId = null;

  const roomSource = await ClassSchedule.findOne({
    isCancelled: false,
    roomNo: { $in: FIXED_VENUES.map((room) => room.name) }
  }).lean();
  assert.ok(roomSource, "Expected a schedule in a registered venue.");
  const roomDayIndex = weekdayNames.indexOf(roomSource.dayOfWeek);
  const roomDate = new Date();
  roomDate.setUTCDate(roomDate.getUTCDate() + ((roomDayIndex - roomDate.getUTCDay() + 7) % 7 || 7));
  const roomScenarioResponse = response();
  await analyzeWhatIfScenario({
    user: { _id: new mongoose.Types.ObjectId(), role: "admin" },
    body: {
      scenarioType: "room-maintenance",
      target: roomSource.roomNo,
      date: roomDate.toISOString().slice(0, 10),
      allDay: true,
      reason: "Automated integration smoke test",
      affectedClassIds: [],
      applyToWeeklyTemplate: false
    }
  }, roomScenarioResponse);
  assert.equal(roomScenarioResponse.code, 201);
  temporaryScenarioId = roomScenarioResponse.data.scenario._id;
  assert.ok(roomScenarioResponse.data.scenario.affectedSchedules.length > 0);
  assert.ok(roomScenarioResponse.data.scenario.affectedSchedules.every((change) => (
    !change.resolved && change.conflicts.length > 0 && (!change.proposed || change.conflicts.some((conflict) => conflict.includes("capacity")))
  )), "Room proposals must remain unresolved when suitability cannot be proven from source data.");
  await WhatIfScenario.deleteOne({ _id: temporaryScenarioId });
  temporaryScenarioId = null;

  const testSchedule = await ClassSchedule.create({
    source: "integration-test",
    program: source.program,
    semester: source.semester,
    batch: source.batch,
    dayOfWeek: "sunday",
    startTime: "23:00",
    endTime: "23:30",
    startMinutes: 1380,
    endMinutes: 1410,
    courseCode: "TEST-WHATIF",
    courseName: "Integration test class",
    facultyName: "Source test faculty",
    roomNo: "CR 1",
    rawText: "Temporary integration test row"
  });
  temporaryScheduleId = testSchedule._id;
  const qualifiedSchedule = await ClassSchedule.create({
    source: "integration-test",
    program: source.program,
    semester: source.semester,
    batch: "ZZ QUALIFICATION TEST",
    dayOfWeek: "monday",
    startTime: "09:00",
    endTime: "10:00",
    startMinutes: 540,
    endMinutes: 600,
    courseCode: testSchedule.courseCode,
    courseName: testSchedule.courseName,
    facultyName: "Replacement test faculty",
    roomNo: "CR 2",
    rawText: "Temporary qualification evidence"
  });
  temporaryExtraScheduleIds.push(qualifiedSchedule._id);
  const existingOverlap = await ClassSchedule.create({
    source: "integration-test",
    program: source.program,
    semester: source.semester,
    batch: source.batch,
    dayOfWeek: "sunday",
    startTime: "23:00",
    endTime: "23:30",
    startMinutes: 1380,
    endMinutes: 1410,
    courseCode: "TEST-EXISTING-OVERLAP",
    courseName: "Pre-existing overlap fixture",
    facultyName: "Other test faculty",
    roomNo: "CR 3",
    rawText: "Temporary existing overlap"
  });
  temporaryExtraScheduleIds.push(existingOverlap._id);
  const analyzedReplacement = response();
  await analyzeWhatIfScenario({
    user: { _id: new mongoose.Types.ObjectId(), role: "admin" },
    body: {
      scenarioType: "faculty-absence",
      target: "Source test faculty",
      date: "2030-01-06",
      allDay: true,
      reason: "Replacement readiness regression test",
      affectedClassIds: [testSchedule._id.toString()]
    }
  }, analyzedReplacement);
  assert.equal(analyzedReplacement.data.scenario.status, "feasible");
  assert.equal(analyzedReplacement.data.scenario.affectedSchedules[0].proposed.facultyName, "Replacement test faculty");
  temporaryScenarioId = analyzedReplacement.data.scenario._id;
  const legacyScenario = await WhatIfScenario.findById(temporaryScenarioId);
  legacyScenario.status = "conflicts-found";
  legacyScenario.affectedSchedules[0].resolved = false;
  legacyScenario.affectedSchedules[0].conflicts = ["The affected batch or section has another overlapping class at this time."];
  await legacyScenario.save();
  const legacyApplyResponse = response();
  await applyWhatIfScenario({ params: { id: temporaryScenarioId }, body: { confirm: true } }, legacyApplyResponse);
  assert.equal(legacyApplyResponse.code, 200, "A legacy false batch-overlap warning must not disable a complete replacement.");
  assert.equal((await ClassSchedule.findById(testSchedule._id).lean()).facultyName, "Replacement test faculty");
  await WhatIfScenario.deleteOne({ _id: temporaryScenarioId });
  temporaryScenarioId = null;
  await ClassSchedule.deleteMany({ _id: { $in: temporaryExtraScheduleIds } });
  temporaryExtraScheduleIds.length = 0;
  await ClassSchedule.deleteOne({ _id: temporaryScheduleId });
  temporaryScheduleId = null;

  const multiBatchResponse = response();
  await saveGeneratedTimetable({
    body: {
      confirmReplace: true,
      assignments: temporaryGeneratedBatches.map((batch, index) => ({
        source: "generated",
        program: "B.Tech",
        semester: "Integration Test",
        batch,
        dayOfWeek: "monday",
        startTime: index === 0 ? "09:00" : "10:00",
        endTime: index === 0 ? "10:00" : "11:00",
        courseCode: "TEST-MULTI-BATCH",
        courseName: "Temporary multi-batch test",
        facultyName: `Test faculty ${index}`,
        roomNo: "CR 1",
        rawText: "Temporary integration test row"
      }))
    }
  }, multiBatchResponse);
  assert.equal(multiBatchResponse.code, 201);
  assert.equal(multiBatchResponse.data.assignments.length, 2);
  assert.deepEqual(multiBatchResponse.data.batches.sort(), [...temporaryGeneratedBatches].sort());
  await ClassSchedule.deleteMany({ batch: { $in: temporaryGeneratedBatches }, semester: "Integration Test", program: "B.Tech" });

  const breakSchedule = await ClassSchedule.create({
    source: "integration-test",
    program: source.program,
    semester: source.semester,
    batch: source.batch,
    dayOfWeek: "monday",
    startTime: "09:00",
    endTime: "10:00",
    startMinutes: 540,
    endMinutes: 600,
    courseCode: "TEST-BREAK",
    courseName: "Temporary break test class",
    facultyName: "Unavailable test faculty",
    roomNo: "CR 1",
    rawText: "Temporary break integration row"
  });
  temporaryScheduleId = breakSchedule._id;
  const breakSnapshot = {
    dayOfWeek: breakSchedule.dayOfWeek,
    startTime: breakSchedule.startTime,
    endTime: breakSchedule.endTime,
    courseCode: breakSchedule.courseCode,
    courseName: breakSchedule.courseName,
    facultyName: breakSchedule.facultyName,
    roomNo: breakSchedule.roomNo,
    batch: breakSchedule.batch,
    semester: breakSchedule.semester,
    program: breakSchedule.program
  };
  const breakScenario = await WhatIfScenario.create({
    scenarioType: "faculty-absence",
    target: breakSnapshot.facultyName,
    disruptionDate: new Date("2030-01-07T00:00:00.000Z"),
    allDay: true,
    reason: "Temporary faculty leave integration test",
    affectedSchedules: [{
      scheduleId: breakSchedule._id,
      original: breakSnapshot,
      proposed: null,
      conflicts: ["No replacement available."],
      resolved: false,
      updatedAtSnapshot: breakSchedule.updatedAt
    }],
    status: "conflicts-found",
    createdBy: new mongoose.Types.ObjectId()
  });
  temporaryScenarioId = breakScenario._id;
  const breakResponse = response();
  await applyWhatIfScenario({ params: { id: breakScenario._id }, body: { confirm: true, action: "break", notifyStudents: true }, user: { _id: new mongoose.Types.ObjectId() } }, breakResponse);
  assert.equal(breakResponse.code, 200);
  temporaryNotificationId = breakResponse.data.scenario.notificationId;
  assert.ok(temporaryNotificationId, "Expected the break fallback to create a notification.");
  const leaveNotification = await Notification.findById(temporaryNotificationId).lean();
  assert.match(leaveNotification.title, /Faculty leave/);
  const exception = await ScheduleException.findOne({ scheduleId: breakSchedule._id, date: "2030-01-07" }).lean();
  assert.ok(exception, "Expected a date-specific schedule exception.");
  assert.match(exception.reason, /Faculty leave/);
  temporaryExceptionId = exception._id;
  assert.equal((await ClassSchedule.findById(breakSchedule._id).lean()).isCancelled, false, "The recurring weekly row must remain active.");
  const datedTimetableResponse = response();
  await getSelectedImportedTimetable({
    user: { role: "admin" },
    query: { program: source.program, semester: source.semester, batch: source.batch, date: "2030-01-07" }
  }, datedTimetableResponse);
  assert.ok(datedTimetableResponse.data.slots.some((slot) => slot.isBreak && slot.courseCode === "BREAK"));
  assert.equal(datedTimetableResponse.data.slots.some((slot) => slot._id?.toString() === breakSchedule._id.toString()), false);
  await ScheduleException.deleteOne({ _id: temporaryExceptionId });
  temporaryExceptionId = null;
  await Notification.deleteOne({ _id: temporaryNotificationId });
  temporaryNotificationId = null;
  await WhatIfScenario.deleteOne({ _id: temporaryScenarioId });
  temporaryScenarioId = null;
  await ClassSchedule.deleteOne({ _id: temporaryScheduleId });
  temporaryScheduleId = null;

  assert.equal(await ClassSchedule.countDocuments({ isCancelled: false }), countBefore);
  assert.equal(await WhatIfScenario.countDocuments({ reason: "Automated integration smoke test" }), scenariosBefore);
  assert.equal(await ClassSchedule.countDocuments({ source: "integration-test" }), testRowsBefore);
  console.log(`Timetable integration smoke test passed (${countBefore} source schedules, scoped reads, both analyses, replacement approval, and date-specific break/notification).`);
} finally {
  if (temporaryScenarioId) await WhatIfScenario.deleteOne({ _id: temporaryScenarioId });
  if (temporaryExceptionId) await ScheduleException.deleteOne({ _id: temporaryExceptionId });
  if (temporaryNotificationId) await Notification.deleteOne({ _id: temporaryNotificationId });
  if (temporaryScheduleId) await ClassSchedule.deleteOne({ _id: temporaryScheduleId });
  if (temporaryExtraScheduleIds.length) await ClassSchedule.deleteMany({ _id: { $in: temporaryExtraScheduleIds } });
  await ClassSchedule.deleteMany({ batch: { $in: temporaryGeneratedBatches }, semester: "Integration Test", program: "B.Tech" });
  await mongoose.disconnect();
}