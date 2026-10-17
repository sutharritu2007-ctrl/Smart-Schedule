import TimetableSlot from "../models/TimetableSlot.js";
import ClassSchedule from "../models/ClassSchedule.js";
import ScheduleException from "../models/ScheduleException.js";
function parseTimeToMinutes(time) {
  if (!time) return null;
  const [hourValue, minuteValue] = String(time).split(":").map(Number);
  if (!Number.isFinite(hourValue) || !Number.isFinite(minuteValue)) return null;
  return hourValue * 60 + minuteValue;
}

// Resolves "today" using a fixed timezone instead of the server's system
// clock. Vercel (and most serverless hosts) run functions in UTC, so
// new Date().getDay() silently returns the wrong day for IST users during
// the UTC/IST offset window. This always resolves against Asia/Kolkata.
function getTodayDayName(timeZone = "Asia/Kolkata") {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" })
    .format(new Date())
    .toLowerCase();
}
// startTime is stored as a string, so a Mongo sort puts "10:00" before "9:00".
// Sort in JS on parsed minutes instead.
const byStartTime = (a, b) => (parseTimeToMinutes(a.startTime) ?? 0) - (parseTimeToMinutes(b.startTime) ?? 0);

const weekOrder = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const byDayThenTime = (a, b) =>
  weekOrder.indexOf(a.dayOfWeek) - weekOrder.indexOf(b.dayOfWeek) || byStartTime(a, b);

const slotFields = ["dayOfWeek", "startTime", "endTime", "courseCode", "courseName", "facultyName", "roomNo", "slotType", "isCancelled"];

const pickSlotFields = (body) =>
  Object.fromEntries(slotFields.filter((field) => body[field] !== undefined).map((field) => [field, body[field]]));

const importedFilterForUser = (user, extra = {}) => ({
  batch: user.batch,
  semester: user.semester,
  isCancelled: false,
  ...extra
});

const importedSort = { dayOfWeek: 1, startMinutes: 1, endMinutes: 1 };

const groupNumbersForSlot = (slot) => {
  if (!/lab/i.test(slot.roomNo || "")) return [];
  const text = [slot.facultyName, slot.rawText, slot.courseName].filter(Boolean).join(" ");
  return [...new Set([...text.matchAll(/Group\s*(\d+)/gi)].map((match) => Number(match[1])))];
};

const permittedScheduleFilter = (user) => user.role === "admin"
  ? { isCancelled: false }
  : { batch: user.batch, semester: user.semester, isCancelled: false };

export const getImportedTimetableOptions = async (req, res) => {
  const filter = permittedScheduleFilter(req.user);
  const [schedules, programs] = await Promise.all([
    ClassSchedule.find(filter).select("program semester batch roomNo facultyName courseName rawText").lean(),
    ClassSchedule.distinct("program", filter)
  ]);
  const semesters = new Set();
  const batches = new Set();
  const sections = new Set();

  schedules.forEach((slot) => {
    const program = slot.program || "";
    const semester = slot.semester || "";
    const batch = slot.batch || "";
    semesters.add(JSON.stringify({ program, semester }));
    batches.add(JSON.stringify({ program, semester, batch }));
    groupNumbersForSlot(slot).forEach((group) => {
      sections.add(JSON.stringify({ program, semester, batch, section: `Group ${group}` }));
    });
  });

  const parseSorted = (values) => [...values].map((value) => JSON.parse(value)).sort((a, b) =>
    a.program.localeCompare(b.program) || a.semester.localeCompare(b.semester) || a.batch.localeCompare(b.batch)
  );
  return res.json({
    programs: programs.filter(Boolean).sort(),
    semesters: parseSorted(semesters),
    batches: parseSorted(batches),
    sections: parseSorted(sections)
  });
};

export const getSelectedImportedTimetable = async (req, res) => {
  const { program, semester, batch, section, date } = req.query;
  if (typeof semester !== "string" || !semester.trim() || typeof batch !== "string" || !batch.trim()) {
    return res.status(400).json({ message: "Select a semester and batch before loading a timetable." });
  }
  if (req.user.role !== "admin" && (semester !== req.user.semester || batch !== req.user.batch)) {
    return res.status(403).json({ message: "You may only view the timetable assigned to your account." });
  }

  const filter = {
    ...permittedScheduleFilter(req.user),
    semester: semester.trim(),
    batch: batch.trim()
  };
  if (program) filter.program = String(program).trim();
  else {
    const programs = await ClassSchedule.distinct("program", filter);
    if (programs.length > 1) {
      return res.status(400).json({ message: "Select a program before loading this timetable." });
    }
    if (programs.length === 1) filter.program = programs[0];
  }
  let slots = await ClassSchedule.find(filter).sort(importedSort).lean();
  if (section) {
    const selectedGroup = /^Group\s+(\d+)$/i.exec(String(section).trim());
    if (!selectedGroup) return res.status(400).json({ message: "Select a valid section." });
    const groupNumber = Number(selectedGroup[1]);
    slots = slots.filter((slot) => {
      const groups = groupNumbersForSlot(slot);
      return groups.length !== 1 || groups[0] === groupNumber;
    });
  }
  let breaks = [];
  if (date) {
    const parsedDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? new Date(`${date}T00:00:00.000Z`)
      : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
      return res.status(400).json({ message: "Choose a valid date." });
    }
    const requestedDay = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" })
      .format(new Date(`${date}T00:00:00.000Z`)).toLowerCase();
    const exceptions = await ScheduleException.find({
      batch: batch.trim(),
      semester: semester.trim(),
      date,
      scheduleId: { $in: slots.map((slot) => slot._id) }
    }).lean();
    const excludedIds = new Set(exceptions.map((exception) => String(exception.scheduleId)));
    slots = slots.filter((slot) => !excludedIds.has(String(slot._id)));
    breaks = exceptions.filter((exception) => exception.dayOfWeek === requestedDay).map((exception) => ({
      _id: `break-${exception._id}`,
      dayOfWeek: exception.dayOfWeek,
      startTime: exception.startTime,
      endTime: exception.endTime,
      startMinutes: parseTimeToMinutes(exception.startTime),
      endMinutes: parseTimeToMinutes(exception.endTime),
      courseCode: "BREAK",
      courseName: `${exception.courseCode} · ${exception.reason || "Class cancelled"}`,
      facultyName: "",
      roomNo: "",
      batch: exception.batch,
      semester: exception.semester,
      program: exception.program,
      isBreak: true,
      exceptionDate: exception.date
    }));
    slots.push(...breaks);
    slots.sort(byDayThenTime);
  }
  return res.json({ program: program || slots[0]?.program || "", semester, batch, section: section || "", date: date || "", breaks, slots });
};

export const getImportedTodayTimetable = async (req, res) => {
  try {
    const day = getTodayDayName();
    const dateParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const dateValues = Object.fromEntries(dateParts.map(({ type, value }) => [type, value]));
    const todayDate = `${dateValues.year}-${dateValues.month}-${dateValues.day}`;
    let classes = await ClassSchedule.find(importedFilterForUser(req.user, { dayOfWeek: day }))
      .sort({ startMinutes: 1, endMinutes: 1 })
      .lean();
    const breaks = await ScheduleException.find({
      batch: req.user.batch,
      semester: req.user.semester,
      date: todayDate,
      dayOfWeek: day
    }).lean();
    const breakIds = new Set(breaks.map((entry) => String(entry.scheduleId)));
    classes = classes.filter((slot) => !breakIds.has(String(slot._id)));

    return res.json({ day, date: todayDate, classes, breaks });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load today's imported timetable" });
  }
};

export const getImportedWeeklyTimetable = async (req, res) => {
  try {
    const slots = await ClassSchedule.find(importedFilterForUser(req.user)).sort(importedSort).lean();
    return res.json({
      batch: req.user.batch,
      semester: req.user.semester,
      slots
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load imported weekly timetable" });
  }
};

export const getTodayTimetable = async (req, res) => {
  try {
    const day = getTodayDayName();
    const classes = await TimetableSlot.find({
      user: req.user._id,
      dayOfWeek: day,
      isCancelled: false
    }).lean();
    classes.sort(byStartTime);

    return res.json({ day, classes });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load today's timetable" });
  }
};

export const getWeeklyTimetable = async (req, res) => {
  try {
    const slots = await TimetableSlot.find({ user: req.user._id }).lean();
    slots.sort(byDayThenTime);
    return res.json({ slots });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load weekly timetable" });
  }
};

export const createSlot = async (req, res) => {
  try {
    const slot = await TimetableSlot.create({ user: req.user._id, ...pickSlotFields(req.body) });
    return res.status(201).json({ message: "Timetable slot created", slot });
  } catch (error) {
    return res.status(400).json({ message: "Invalid timetable slot data" });
  }
};

export const updateSlot = async (req, res) => {
  try {
    const slot = await TimetableSlot.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      pickSlotFields(req.body),
      { new: true, runValidators: true }
    );

    if (!slot) {
      return res.status(404).json({ message: "Timetable slot not found" });
    }

    return res.json({ message: "Timetable slot updated", slot });
  } catch (error) {
    return res.status(400).json({ message: "Invalid timetable slot data" });
  }
};

export const deleteSlot = async (req, res) => {
  try {
    const slot = await TimetableSlot.findOneAndDelete({ _id: req.params.id, user: req.user._id });

    if (!slot) {
      return res.status(404).json({ message: "Timetable slot not found" });
    }

    return res.json({ message: "Timetable slot deleted" });
  } catch (error) {
    return res.status(400).json({ message: "Invalid timetable slot id" });
  }
};