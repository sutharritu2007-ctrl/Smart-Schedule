import mongoose from "mongoose";

const scheduleExceptionSchema = new mongoose.Schema(
  {
    scheduleId: { type: mongoose.Schema.Types.ObjectId, ref: "ClassSchedule", required: true, index: true },
    scenarioId: { type: mongoose.Schema.Types.ObjectId, ref: "WhatIfScenario", required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    dayOfWeek: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    batch: { type: String, required: true, index: true },
    semester: { type: String, required: true },
    program: { type: String, required: true },
    courseCode: { type: String, required: true },
    courseName: { type: String, default: "" },
    facultyName: { type: String, default: "" },
    roomNo: { type: String, default: "" },
    reason: { type: String, default: "" },
    notificationId: { type: mongoose.Schema.Types.ObjectId, ref: "Notification", default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

scheduleExceptionSchema.index({ scheduleId: 1, date: 1 }, { unique: true });
scheduleExceptionSchema.index({ batch: 1, semester: 1, date: 1 });

const ScheduleException = mongoose.model("ScheduleException", scheduleExceptionSchema);

export default ScheduleException;