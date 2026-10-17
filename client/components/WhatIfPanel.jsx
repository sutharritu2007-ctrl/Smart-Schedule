import { useEffect, useState } from "react";
import api from "../src/api";
import "./styling/what-if.css";

const emptyScenario = {
  scenarioType: "faculty-absence",
  target: "",
  date: "",
  allDay: true,
  startTime: "09:00",
  endTime: "17:00",
  reason: ""
};

const statuses = {
  "pending-review": "Pending review",
  feasible: "Feasible",
  "conflicts-found": "Conflicts found",
  applied: "Applied",
  rejected: "Rejected"
};

const getScenarioStatusLabel = (entry) => {
  if (entry.status === "applied" || entry.status === "rejected") return statuses[entry.status];
  if (entry.status === "feasible") return entry.scenarioType === "faculty-absence" ? "Replacement ready" : "Room change ready";
  if (isLegacyReplacementReady(entry)) return entry.scenarioType === "faculty-absence" ? "Replacement ready" : "Room change ready";
  const proposedCount = entry.affectedSchedules?.filter((change) => change.proposed).length || 0;
  if (proposedCount && proposedCount === entry.affectedSchedules?.length) return "Replacement proposed · reanalyze";
  if (proposedCount) return "Some replacements available";
  if (!entry.affectedSchedules?.length) return "No affected classes";
  return entry.scenarioType === "faculty-absence" ? "Leave available" : "Break available";
};

const isLegacyBatchOverlap = (conflicts = []) => (
  conflicts.length > 0 && conflicts.every((conflict) => conflict === "The affected batch or section has another overlapping class at this time.")
);

const isLegacyReplacementReady = (entry) => (
  entry.status === "conflicts-found" &&
  entry.affectedSchedules?.length > 0 &&
  entry.affectedSchedules.every((change) => change.proposed && (change.resolved || isLegacyBatchOverlap(change.conflicts || [])))
);

const canApplyReplacement = (entry) => entry.status === "feasible" || isLegacyReplacementReady(entry);

const getReplacementActionLabel = (entry) => {
  const replacements = [...new Set((entry.affectedSchedules || []).flatMap((change) => {
    if (!change.proposed) return [];
    if (change.original.facultyName !== change.proposed.facultyName) return [change.proposed.facultyName];
    if (change.original.roomNo !== change.proposed.roomNo) return [change.proposed.roomNo];
    return [];
  }))];
  if (entry.scenarioType === "faculty-absence" && replacements.length) return `Approve replacement · ${replacements.join(", ")}`;
  if (entry.scenarioType === "room-maintenance" && replacements.length) return `Approve room change · ${replacements.join(", ")}`;
  return "Approve proposed change";
};

const formatDate = (value) => value ? new Date(value).toLocaleDateString() : "";
const weekDays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const timeMinutes = (value) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""));
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

export default function WhatIfPanel({ onApplied }) {
  const [options, setOptions] = useState({ faculty: [], rooms: [] });
  const [scenario, setScenario] = useState(emptyScenario);
  const [scenarios, setScenarios] = useState([]);
  const [candidateResultKey, setCandidateResultKey] = useState("");
  const [candidateClasses, setCandidateClasses] = useState([]);
  const [selectedClassIds, setSelectedClassIds] = useState([]);
  const [restrictAffected, setRestrictAffected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [workingId, setWorkingId] = useState("");
  const [notifyChoices, setNotifyChoices] = useState({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const candidateKey = scenario.date && scenario.target
    ? JSON.stringify([scenario.scenarioType, scenario.target, scenario.date, scenario.allDay, scenario.startTime, scenario.endTime])
    : "";

  const loadData = async () => {
    try {
      const [optionsResponse, scenariosResponse] = await Promise.all([
        api.get("/admin/what-if/options"),
        api.get("/admin/what-if")
      ]);
      setOptions(optionsResponse.data);
      setScenarios(scenariosResponse.data.scenarios || []);
      setError("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to load disruption data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    Promise.all([api.get("/admin/what-if/options"), api.get("/admin/what-if")])
      .then(([optionsResponse, scenariosResponse]) => {
        setOptions(optionsResponse.data);
        setScenarios(scenariosResponse.data.scenarios || []);
      })
      .catch((requestError) => {
        setError(requestError.response?.data?.message || "Unable to load disruption data.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!candidateKey) return undefined;
    let cancelled = false;
    const date = new Date(`${scenario.date}T00:00:00.000Z`);
    const day = weekDays[date.getUTCDay()];
    api.get("/admin/schedules", { params: { day } })
      .then((response) => {
        if (cancelled) return;
        const start = scenario.allDay ? 0 : timeMinutes(scenario.startTime);
        const end = scenario.allDay ? 1440 : timeMinutes(scenario.endTime);
        const matches = (response.data.schedules || []).filter((slot) => {
          if (slot.isCancelled) return false;
          const matchesTarget = scenario.scenarioType === "faculty-absence"
            ? String(slot.facultyName || "").split(new RegExp("[/,;]+")).some((name) => name.trim().toLowerCase() === scenario.target.toLowerCase())
            : String(slot.roomNo || "").trim().toLowerCase() === scenario.target.trim().toLowerCase();
          const slotStart = timeMinutes(slot.startTime);
          const slotEnd = timeMinutes(slot.endTime);
          return matchesTarget && slotStart !== null && slotEnd !== null && slotStart < end && start < slotEnd;
        });
        setCandidateClasses(matches);
        setSelectedClassIds(matches.map((slot) => slot._id));
        setCandidateResultKey(candidateKey);
      })
      .catch(() => {
        if (!cancelled) {
          setCandidateClasses([]);
          setSelectedClassIds([]);
          setCandidateResultKey(candidateKey);
        }
      });
    return () => { cancelled = true; };
  }, [candidateKey, scenario.date, scenario.scenarioType, scenario.target, scenario.allDay, scenario.startTime, scenario.endTime]);

  const updateField = (field, value) => {
    setScenario((current) => ({ ...current, [field]: value }));
  };

  const analyze = async (event) => {
    event.preventDefault();
    if (restrictAffected && candidateKey !== candidateResultKey) {
      setError("Wait for the matching class list to finish loading.");
      return;
    }
    if (restrictAffected && selectedClassIds.length === 0) {
      setError("Select at least one affected class, or turn off the class-only filter.");
      return;
    }
    setAnalyzing(true);
    setError("");
    setMessage("");
    try {
      const response = await api.post("/admin/what-if", {
        ...scenario,
        affectedClassIds: restrictAffected ? selectedClassIds : []
      });
      setScenarios((current) => [response.data.scenario, ...current.filter((item) => item._id !== response.data.scenario._id)]);
      setMessage(`Analysis saved as ${statuses[response.data.scenario.status]}.`);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to analyze this disruption.");
    } finally {
      setAnalyzing(false);
    }
  };

  const apply = async (entry, action = "replacement") => {
    const notificationRequested = Boolean(notifyChoices[entry._id]);
    const confirmation = action === "break"
      ? `Add a break for affected class(es) on ${formatDate(entry.disruptionDate)}${notificationRequested ? " and notify affected students" : ""}? The regular weekly classes remain unchanged.`
      : "Apply these changes to the recurring weekly timetable? This updates every future occurrence of the affected weekday.";
    if (!window.confirm(confirmation)) return;
    setWorkingId(entry._id);
    setError("");
    setMessage("");
    try {
      const response = await api.post(`/admin/what-if/${entry._id}/apply`, action === "break"
        ? { confirm: true, action, notifyStudents: notificationRequested }
        : { confirm: true });
      setScenarios((current) => current.map((scenarioItem) => scenarioItem._id === entry._id ? response.data.scenario : scenarioItem));
      setMessage(action === "break"
        ? notificationRequested ? "Date-specific break recorded and notification sent." : "Date-specific break recorded. No notification was sent."
        : "Approved timetable changes were applied.");
      await loadData();
      onApplied?.(response.data.scenario);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to apply the proposal.");
    } finally {
      setWorkingId("");
    }
  };

  const reanalyze = async (entry) => {
    setWorkingId(entry._id);
    setError("");
    setMessage("");
    try {
      const response = await api.post("/admin/what-if", {
        scenarioType: entry.scenarioType,
        target: entry.target,
        date: new Date(entry.disruptionDate).toISOString().slice(0, 10),
        allDay: entry.allDay,
        startTime: entry.startTime,
        endTime: entry.endTime,
        reason: entry.reason || "",
        affectedClassIds: []
      });
      setScenarios((current) => [response.data.scenario, ...current.filter((item) => item._id !== response.data.scenario._id)]);
      await api.post(`/admin/what-if/${entry._id}/reject`);
      await loadData();
      setMessage(`Scenario reanalyzed: ${statuses[response.data.scenario.status]}. The previous analysis was closed.`);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to reanalyze this disruption.");
    } finally {
      setWorkingId("");
    }
  };

  const reject = async (entry) => {
    setWorkingId(entry._id);
    setError("");
    try {
      await api.post(`/admin/what-if/${entry._id}/reject`);
      await loadData();
      setMessage("Proposal rejected. The timetable was not changed.");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to reject the proposal.");
    } finally {
      setWorkingId("");
    }
  };

  const targets = scenario.scenarioType === "faculty-absence" ? options.faculty : options.rooms.map((room) => room.name);

  return (
    <section className="what-if-section" aria-labelledby="what-if-title">
      <header className="what-if-heading">
        <div>
          <p className="what-if-kicker">ADMIN DISRUPTION PLANNER</p>
          <h2 id="what-if-title">What-If scheduling</h2>
          <p>Analyze faculty absence or room maintenance against saved timetable assignments.</p>
        </div>
        <span className="what-if-count">{scenarios.length} saved scenarios</span>
      </header>

      <form className="what-if-form" onSubmit={analyze}>
        <div className="what-if-fields">
          <label>Disruption
            <select value={scenario.scenarioType} onChange={(event) => {
              const scenarioType = event.target.value;
              setScenario((current) => ({ ...current, scenarioType, target: "" }));
            }}>
              <option value="faculty-absence">Faculty absence</option>
              <option value="room-maintenance">Room maintenance</option>
            </select>
          </label>
          <label>{scenario.scenarioType === "faculty-absence" ? "Faculty member" : "Room"}
            <select required value={scenario.target} onChange={(event) => updateField("target", event.target.value)}>
              <option value="">Choose from existing records</option>
              {targets.map((target) => <option key={target} value={target}>{target}</option>)}
            </select>
          </label>
          <label>Date<input type="date" required value={scenario.date} onChange={(event) => updateField("date", event.target.value)} /></label>
          <label className="what-if-reason">Reason (optional)<input maxLength="500" value={scenario.reason} onChange={(event) => updateField("reason", event.target.value)} placeholder="Add a note for reviewers" /></label>
        </div>

        <label className="what-if-check"><input type="checkbox" checked={scenario.allDay} onChange={(event) => updateField("allDay", event.target.checked)} />All day</label>
        {!scenario.allDay && (
          <div className="what-if-time-range">
            <label>From<input type="time" required value={scenario.startTime} onChange={(event) => updateField("startTime", event.target.value)} /></label>
            <label>Until<input type="time" required value={scenario.endTime} onChange={(event) => updateField("endTime", event.target.value)} /></label>
          </div>
        )}

        <div className="what-if-affected-picker">
          <label className="what-if-check"><input type="checkbox" checked={restrictAffected} onChange={(event) => setRestrictAffected(event.target.checked)} />Limit this scenario to selected matching classes</label>
          {restrictAffected && (candidateKey !== candidateResultKey ? <p className="what-if-note">Loading matching classes...</p> : candidateClasses.length === 0 ? <p className="what-if-note">No matching classes were found for these inputs.</p> : (
            <div className="what-if-class-options">
              {candidateClasses.map((slot) => (
                <label key={slot._id}>
                  <input type="checkbox" checked={selectedClassIds.includes(slot._id)} onChange={(event) => setSelectedClassIds((current) => event.target.checked ? [...current, slot._id] : current.filter((id) => id !== slot._id))} />
                  <span><strong>{slot.courseCode}</strong> · {slot.batch} · {slot.startTime}–{slot.endTime} · {slot.roomNo}</span>
                </label>
              ))}
            </div>
          ))}
        </div>

        <p className="what-if-note">A date selects its weekday in the stored recurring schedule. The final approval prompt confirms changes apply to future occurrences of that weekday.</p>

        {error && <p className="what-if-alert what-if-alert--error" role="alert">{error}</p>}
        {message && <p className="what-if-alert" role="status">{message}</p>}
        <div className="what-if-actions">
          <button className="what-if-primary" type="submit" disabled={analyzing || loading || !targets.length}>{analyzing ? "Analyzing..." : "Analyze disruption"}</button>
        </div>
      </form>

      {loading ? <p className="what-if-empty">Loading scenarios...</p> : scenarios.length === 0 ? (
        <p className="what-if-empty">No saved disruption scenarios.</p>
      ) : (
        <div className="what-if-list">
          {scenarios.map((entry) => (
            <article className="what-if-item" key={entry._id}>
              <header className="what-if-item-heading">
                <div><h3>{entry.scenarioType === "faculty-absence" ? "Faculty absence" : "Room maintenance"} · {entry.target}</h3><p>{formatDate(entry.disruptionDate)} · {entry.allDay ? "All day" : `${entry.startTime}–${entry.endTime}`}</p></div>
                <span className={`what-if-status what-if-status--${entry.status}`}>{getScenarioStatusLabel(entry)}</span>
              </header>
              {entry.reason && <p className="what-if-reason-text">{entry.reason}</p>}
              <div className="what-if-change-list">
                {entry.affectedSchedules.map((change) => (
                  <div className="what-if-change" key={change.scheduleId}>
                    <div><strong>Original · {change.original.courseCode}</strong><span>{change.original.batch} · {change.original.semester}</span><span>{change.original.dayOfWeek} {change.original.startTime}–{change.original.endTime}</span><span>Faculty: {change.original.facultyName || "Unassigned"}</span><span>Room: {change.original.roomNo}</span></div>
                    <span className="what-if-arrow" aria-hidden="true">→</span>
                    <div>{change.proposed ? <><strong>Proposed · {change.proposed.courseCode}</strong><span>{change.proposed.dayOfWeek} {change.proposed.startTime}–{change.proposed.endTime}</span><span>Faculty: {change.proposed.facultyName || "Unassigned"}</span><span>Room: {change.proposed.roomNo}</span></> : <strong>No valid proposal</strong>}</div>
                    {change.conflicts?.filter((conflict) => conflict !== "The affected batch or section has another overlapping class at this time.").length > 0 && <ul className="what-if-conflicts">{change.conflicts.filter((conflict) => conflict !== "The affected batch or section has another overlapping class at this time.").map((conflict) => <li key={conflict}>{conflict}</li>)}</ul>}
                  </div>
                ))}
              </div>
              {entry.analysisNotes?.filter((note) => !note.startsWith("Applying changes is disabled")).length > 0 && <ul className="what-if-notes">{entry.analysisNotes.filter((note) => !note.startsWith("Applying changes is disabled")).map((note) => <li key={note}>{note}</li>)}</ul>}
              {entry.status !== "applied" && entry.status !== "rejected" && (
                <>
                  <footer className="what-if-item-actions">
                    <button type="button" className="what-if-secondary" disabled={workingId === entry._id} onClick={() => reject(entry)}>Reject proposal</button>
                    {(entry.status === "pending-review" || (entry.status === "conflicts-found" && !isLegacyReplacementReady(entry))) ? <button type="button" className="what-if-secondary" disabled={workingId === entry._id} onClick={() => reanalyze(entry)}>{workingId === entry._id ? "Reanalyzing..." : "Reanalyze"}</button> : null}
                    {!canApplyReplacement(entry) && entry.affectedSchedules?.length > 0 && entry.affectedSchedules.every((change) => !change.proposed) && (
                      <>
                        <label className="what-if-notify-choice">
                          <input type="checkbox" checked={Boolean(notifyChoices[entry._id])} onChange={(event) => setNotifyChoices((current) => ({ ...current, [entry._id]: event.target.checked }))} />
                          Send notification to affected students
                        </label>
                        <button type="button" className="what-if-secondary" disabled={workingId === entry._id} onClick={() => apply(entry, "break")}>
                          {workingId === entry._id ? "Adding break..." : "Add break"}
                        </button>
                      </>
                    )}
                    <button type="button" className="what-if-primary" disabled={workingId === entry._id || !canApplyReplacement(entry)} onClick={() => apply(entry)}>{workingId === entry._id ? "Applying..." : getReplacementActionLabel(entry)}</button>
                  </footer>
                </>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}