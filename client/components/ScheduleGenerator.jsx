import { useEffect, useState } from "react";
import api from "../src/api";
import "./styling/schedule-generator.css";

const days = [
  { key: "monday", label: "Mon" },
  { key: "tuesday", label: "Tue" },
  { key: "wednesday", label: "Wed" },
  { key: "thursday", label: "Thu" },
  { key: "friday", label: "Fri" },
  { key: "saturday", label: "Sat" }
];

const profileNames = {
  "student-experience": "Student experience",
  "room-utilization": "Room utilization",
  "faculty-balance": "Faculty balance"
};

const formatGapMinutes = (minutes = 0) => {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
};

const newCourse = () => ({
  courseCode: "",
  courseName: "",
  sessionsPerWeek: 1,
  durationHours: 1,
  facultyName: "",
  students: 1,
  roomType: "classroom",
  availableDays: [],
  availableFromHour: "",
  availableUntilHour: ""
});

export default function ScheduleGenerator({ onSaved, batch, semester, program, availableBatches = [] }) {
  const [venues, setVenues] = useState([]);
  const [courses, setCourses] = useState([newCourse()]);
  const [rooms, setRooms] = useState([]);
  const [roomChoice, setRoomChoice] = useState("");
  const [roomCapacity, setRoomCapacity] = useState("");
  const [generateAllBatches, setGenerateAllBatches] = useState(false);
  const [workingDays, setWorkingDays] = useState(days.slice(0, 5).map((day) => day.key));
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(17);
  const [alternatives, setAlternatives] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/venues")
      .then((response) => setVenues(response.data.venues || []))
      .catch(() => setError("Unable to load the venue list."));
  }, []);

  const updateCourse = (index, field, value) => {
    setCourses((current) => current.map((course, courseIndex) => (
      courseIndex === index ? { ...course, [field]: value } : course
    )));
  };

  const toggleWorkingDay = (day) => {
    setWorkingDays((current) => current.includes(day)
      ? current.filter((entry) => entry !== day)
      : [...current, day]);
  };

  const addRoom = () => {
    const venue = venues.find((entry) => entry.name === roomChoice);
    const capacity = roomCapacity.trim() === "" ? 0 : Number(roomCapacity);
    if (!venue || !Number.isInteger(capacity) || capacity < 0 || (venue.type === "classroom" && capacity < 1)) {
      setError("Classrooms need a valid seating capacity. Lab capacity is optional.");
      return;
    }
    setRooms((current) => [...current, { name: venue.name, type: venue.type, capacity }]);
    setRoomChoice("");
    setRoomCapacity("");
    setError("");
  };

  const generate = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setAlternatives([]);
    if (!batch.trim() || !semester.trim()) {
      setError("Enter the batch and semester for this timetable.");
      return;
    }
    if (!workingDays.length || !rooms.length || courses.some((course) => (
      !course.courseCode.trim() || !course.facultyName.trim() || !course.students
    ))) {
      setError("Add at least one working day and room, and complete each course code, faculty, and class size.");
      return;
    }

    setLoading(true);
    try {
      const targetBatches = generateAllBatches ? availableBatches : [batch];
      const response = await api.post("/admin/timetable/generate", {
        courses: targetBatches.flatMap((targetBatch) => courses.map((course) => ({
          ...course,
          availableFromHour: course.availableFromHour === "" ? null : Number(course.availableFromHour),
          availableUntilHour: course.availableUntilHour === "" ? null : Number(course.availableUntilHour),
          batch: targetBatch.trim()
        }))),
        rooms,
        workingDays,
        startHour: Number(startHour),
        endHour: Number(endHour),
        semester: semester.trim(),
        program: program.trim() || "B.Tech"
      });
      setAlternatives(response.data.alternatives || []);
      setSelectedProfile(response.data.alternatives?.[0]?.profile || "");
      if (!response.data.alternatives?.length) {
        setMessage(`Solver status: ${response.data.status}. No valid timetable was found for these requirements.`);
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Timetable generation failed. Check the scheduler service and inputs.");
    } finally {
      setLoading(false);
    }
  };

  const saveAlternative = async () => {
    const alternative = alternatives.find((entry) => entry.profile === selectedProfile);
    if (!alternative) return;
    const targetLabel = generateAllBatches ? `${availableBatches.length} batches (${availableBatches.join(", ")})` : batch;
    const confirmed = window.confirm(
      `Replace existing timetables for ${targetLabel} · ${semester} with this ${profileNames[alternative.profile]} schedule? This cannot be undone.`
    );
    if (!confirmed) return;

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await api.post("/admin/timetable/save-generated", {
        assignments: alternative.assignments,
        confirmReplace: true
      });
      setMessage(`${alternative.assignments.length} sessions saved for ${targetLabel} · ${semester}.`);
      onSaved?.(response.data.assignments || alternative.assignments);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to save this timetable.");
    } finally {
      setSaving(false);
    }
  };

  const selectedAlternative = alternatives.find((entry) => entry.profile === selectedProfile);
  const selectedVenue = venues.find((venue) => venue.name === roomChoice);
  const availableVenues = venues.filter((venue) => !rooms.some((room) => room.name === venue.name));

  return (
    <section className="generator-section" aria-labelledby="generator-title">
      <div className="generator-heading">
        <div>
          <p className="generator-kicker">CP-SAT SCHEDULER</p>
          <h2 id="generator-title">Generate a timetable</h2>
          <p>Set the teaching requirements and review three optimized schedules before saving.</p>
        </div>
        <span className="generator-engine">OR-TOOLS</span>
      </div>

      <form className="generator-form" onSubmit={generate}>
        <div className="generator-scope">
          <div className="generator-scope-value"><span>Program</span><strong>{program}</strong></div>
          <div className="generator-scope-value"><span>Semester</span><strong>{semester}</strong></div>
          <div className="generator-scope-value"><span>Batch</span><strong>{batch}</strong></div>
        </div>
        {availableBatches.length > 1 && (
          <label className="generator-all-batches">
            <input type="checkbox" checked={generateAllBatches} onChange={(event) => {
              setGenerateAllBatches(event.target.checked);
              setAlternatives([]);
            }} />
            Generate all {availableBatches.length} existing batches for this semester
            <small>The course requirements above are copied to each batch; room and faculty conflicts are optimized together.</small>
          </label>
        )}

        <div className="generator-subheading">
          <div><h3>Course requirements</h3><span>{courses.length} course{courses.length === 1 ? "" : "s"}</span></div>
          <button type="button" className="generator-secondary" onClick={() => setCourses((current) => [...current, newCourse()])}>+ Add course</button>
        </div>
        <div className="generator-course-list">
          {courses.map((course, index) => (
            <fieldset className="generator-course" key={index}>
              <legend>Course {String(index + 1).padStart(2, "0")}</legend>
              <button
                type="button"
                className="generator-remove"
                aria-label={`Remove course ${index + 1}`}
                disabled={courses.length === 1}
                onClick={() => setCourses((current) => current.filter((_, courseIndex) => courseIndex !== index))}
              >Remove</button>
              <div className="generator-course-fields">
                <label>Course code<input value={course.courseCode} onChange={(event) => updateCourse(index, "courseCode", event.target.value)} placeholder="CS301" required /></label>
                <label>Course name<input value={course.courseName} onChange={(event) => updateCourse(index, "courseName", event.target.value)} placeholder="Operating Systems" /></label>
                <label>Faculty<input value={course.facultyName} onChange={(event) => updateCourse(index, "facultyName", event.target.value)} required /></label>
                <label>Students<input type="number" min="1" max="1000" value={course.students} onChange={(event) => updateCourse(index, "students", Number(event.target.value))} required /></label>
                <label>Sessions / week<input type="number" min="1" max="10" value={course.sessionsPerWeek} onChange={(event) => updateCourse(index, "sessionsPerWeek", Number(event.target.value))} required /></label>
                <label>Duration<select value={course.durationHours} onChange={(event) => updateCourse(index, "durationHours", Number(event.target.value))}><option value={1}>1 hour</option><option value={2}>2 hours</option><option value={3}>3 hours</option><option value={4}>4 hours</option></select></label>
                <label>Room type<select value={course.roomType} onChange={(event) => updateCourse(index, "roomType", event.target.value)}><option value="classroom">Classroom</option><option value="lab">Lab</option></select></label>
                <label>Faculty from<input type="number" min="6" max="22" value={course.availableFromHour} onChange={(event) => updateCourse(index, "availableFromHour", event.target.value)} placeholder="Any time" /></label>
                <label>Faculty until<input type="number" min="7" max="23" value={course.availableUntilHour} onChange={(event) => updateCourse(index, "availableUntilHour", event.target.value)} placeholder="Any time" /></label>
                <label>Faculty days<select multiple value={course.availableDays} onChange={(event) => updateCourse(index, "availableDays", [...event.target.selectedOptions].map((option) => option.value))} aria-label={`Faculty availability for course ${index + 1}`}>
                  {days.filter((day) => workingDays.includes(day.key)).map((day) => <option key={day.key} value={day.key}>{day.label}</option>)}
                </select><small>Leave empty for all working days</small></label>
              </div>
            </fieldset>
          ))}
        </div>

        <div className="generator-resource-grid">
          <section className="generator-resource">
            <h3>Rooms and capacities</h3>
            <div className="generator-room-add">
              <select aria-label="Choose room" value={roomChoice} onChange={(event) => setRoomChoice(event.target.value)}>
                <option value="">Choose a room</option>
                {availableVenues.map((venue) => <option key={venue.name} value={venue.name}>{venue.name} · {venue.type}</option>)}
              </select>
              <input aria-label="Room capacity (required for classrooms only)" type="number" min={selectedVenue?.type === "lab" ? "0" : "1"} max="1000" placeholder={selectedVenue?.type === "lab" ? "Seats (optional for labs)" : "Seats (classrooms)"} value={roomCapacity} onChange={(event) => setRoomCapacity(event.target.value)} />
              <button type="button" className="generator-secondary" onClick={addRoom} disabled={!availableVenues.length}>Add</button>
            </div>
            {rooms.length > 0 ? (
              <ul className="generator-room-list">
                {rooms.map((room) => <li key={room.name}><span>{room.name} <small>{room.type}</small></span><strong>{room.capacity ? `${room.capacity} seats` : "Capacity not required"}</strong><button type="button" aria-label={`Remove ${room.name}`} onClick={() => setRooms((current) => current.filter((entry) => entry.name !== room.name))}>×</button></li>)}
              </ul>
            ) : <p className="generator-hint">Classrooms require seating capacity. Lab capacity is optional and does not limit cohort size.</p>}
          </section>

          <section className="generator-resource">
            <h3>Working window</h3>
            <div className="generator-days" aria-label="Working days">
              {days.map((day) => <label key={day.key} className={workingDays.includes(day.key) ? "is-selected" : ""}><input type="checkbox" checked={workingDays.includes(day.key)} onChange={() => toggleWorkingDay(day.key)} />{day.label}</label>)}
            </div>
            <div className="generator-hours">
              <label>From<input type="number" min="6" max="18" value={startHour} onChange={(event) => setStartHour(Number(event.target.value))} /></label>
              <span>to</span>
              <label>Until<input type="number" min="7" max="23" value={endHour} onChange={(event) => setEndHour(Number(event.target.value))} /></label>
              <span>24-hour time</span>
            </div>
          </section>
        </div>

        {error && <p className="generator-alert generator-alert--error" role="alert">{error}</p>}
        {message && <p className="generator-alert" role="status">{message}</p>}
        <div className="generator-submit-row">
          <p>All sessions, room capacities, and resource conflicts are treated as hard constraints.</p>
          <button className="generator-submit" type="submit" disabled={loading}>{loading ? "Solving..." : "Generate alternatives"}</button>
        </div>
      </form>

      {alternatives.length > 0 && (
        <div className="generator-results">
          <div className="generator-subheading">
            <div><h3>Generated alternatives</h3><span>{selectedAlternative?.status || "FEASIBLE"} · {selectedAlternative?.assignments.length} sessions</span></div>
            <button type="button" className="generator-submit" onClick={saveAlternative} disabled={saving}>{saving ? "Saving..." : "Save selected timetable"}</button>
          </div>
          <div className="generator-tabs" role="tablist" aria-label="Timetable objectives">
            {alternatives.map((alternative) => <button key={alternative.profile} type="button" role="tab" aria-selected={selectedProfile === alternative.profile} className={selectedProfile === alternative.profile ? "is-active" : ""} onClick={() => setSelectedProfile(alternative.profile)}>{profileNames[alternative.profile]}</button>)}
          </div>
          {selectedAlternative && (
            <>
              <div className="generator-student-metrics" aria-label="Student schedule impact">
                <div><span>Students represented</span><strong>{selectedAlternative.studentMetrics?.estimatedStudents ?? 0}</strong></div>
                <div><span>Estimated idle time</span><strong>{formatGapMinutes(selectedAlternative.studentMetrics?.estimatedStudentGapMinutes)}</strong><small>student-weighted weekly gaps</small></div>
                <div><span>Student-days on campus</span><strong>{selectedAlternative.studentMetrics?.estimatedStudentDaysOnCampus ?? 0}</strong><small>estimated across this batch</small></div>
              </div>
              <div className="generator-result-table-wrap">
                <table className="generator-result-table">
                  <thead><tr><th>Day</th><th>Time</th><th>Course</th><th>Students</th><th>Faculty</th><th>Room</th></tr></thead>
                  <tbody>{selectedAlternative.assignments.map((assignment, index) => (
                    <tr key={`${assignment.courseCode}-${assignment.dayOfWeek}-${assignment.startTime}-${index}`}>
                      <td>{assignment.dayOfWeek}</td>
                      <td>{assignment.startTime}–{assignment.endTime}</td>
                      <td><strong>{assignment.courseCode}</strong><small>{assignment.courseName}</small></td>
                      <td>{assignment.students}</td>
                      <td>{assignment.facultyName}</td>
                      <td>{assignment.roomNo}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}