import mongoose from "mongoose";

const scheduleSnapshotSchema = new mongoose.Schema(
  {
    scheduleId: { type: mongoose.Schema.Types.ObjectId, ref: "ClassSchedule", required: true },
    original: { type: mongoose.Schema.Types.Mixed, required: true },
    proposed: { type: mongoose.Schema.Types.Mixed, default: null },
    conflicts: { type: [String], default: [] },
    resolved: { type: Boolean, default: false },
    updatedAtSnapshot: { type: Date, default: null }
  },
  { _id: false }
);

const whatIfScenarioSchema = new mongoose.Schema(
  {
    scenarioType: { type: String, enum: ["faculty-absence", "room-maintenance"], required: true },
    target: { type: String, required: true, trim: true },
    disruptionDate: { type: Date, required: true },
    allDay: { type: Boolean, default: false },
    startTime: { type: String, default: "" },
    endTime: { type: String, default: "" },
    reason: { type: String, default: "", maxlength: 500 },
    applyToWeeklyTemplate: { type: Boolean, default: false },
    affectedSchedules: { type: [scheduleSnapshotSchema], default: [] },
    status: {
      type: String,
      enum: ["pending-review", "feasible", "conflicts-found", "applied", "rejected"],
      default: "pending-review"
    },
    analysisNotes: { type: [String], default: [] },
    notificationId: { type: mongoose.Schema.Types.ObjectId, ref: "Notification", default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    appliedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

whatIfScenarioSchema.index({ createdBy: 1, createdAt: -1 });

const WhatIfScenario = mongoose.model("WhatIfScenario", whatIfScenarioSchema);

export default WhatIfScenario;