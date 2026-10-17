from collections import defaultdict
from typing import Literal

from fastapi import FastAPI, HTTPException
from ortools.sat.python import cp_model
from pydantic import BaseModel, Field


Day = Literal["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
RoomType = Literal["classroom", "lab"]


class CourseRequirement(BaseModel):
    courseCode: str = Field(min_length=1, max_length=30)
    courseName: str = Field(default="", max_length=120)
    sessionsPerWeek: int = Field(ge=1, le=10)
    durationHours: int = Field(ge=1, le=4)
    facultyName: str = Field(min_length=1, max_length=100)
    batch: str = Field(min_length=1, max_length=60)
    students: int = Field(ge=1, le=1000)
    roomType: RoomType
    availableDays: list[Day] = Field(default_factory=list)
    availableFromHour: int | None = Field(default=None, ge=6, le=22)
    availableUntilHour: int | None = Field(default=None, ge=7, le=23)


class RoomRequirement(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    type: RoomType
    capacity: int = Field(default=0, ge=0, le=1000)


class GenerationRequest(BaseModel):
    courses: list[CourseRequirement] = Field(min_length=1, max_length=80)
    rooms: list[RoomRequirement] = Field(min_length=1, max_length=40)
    workingDays: list[Day] = Field(min_length=1)
    startHour: int = Field(ge=6, le=18)
    endHour: int = Field(ge=7, le=23)
    semester: str = Field(min_length=1, max_length=30)
    program: str = Field(default="B.Tech", max_length=60)


app = FastAPI(title="SmartSchedule CP-SAT Scheduler")
DAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
PROFILES = ["student-experience", "room-utilization", "faculty-balance"]
STUDENT_EARLY_CLASS_COST_MINUTES = 30
STUDENT_LATE_CLASS_COST_MINUTES = 90
STUDENT_EXTRA_CAMPUS_DAY_COST_MINUTES = 180
STUDENT_DAILY_LOAD_COST_MINUTES = 30


def calculate_student_metrics(assignments: list[dict]) -> dict:
    batches = defaultdict(lambda: defaultdict(list))
    enrollment = defaultdict(int)
    for assignment in assignments:
        batch = assignment["batch"]
        enrollment[batch] = max(enrollment[batch], assignment["students"])
        batches[batch][assignment["dayOfWeek"]].append(assignment)

    weighted_gap_minutes = 0
    student_days_on_campus = 0
    for batch, daily_schedules in batches.items():
        for classes in daily_schedules.values():
            classes.sort(key=lambda item: item["startTime"])
            starts = [int(item["startTime"].split(":")[0]) * 60 + int(item["startTime"].split(":")[1]) for item in classes]
            ends = [int(item["endTime"].split(":")[0]) * 60 + int(item["endTime"].split(":")[1]) for item in classes]
            busy_minutes = sum(end - start for start, end in zip(starts, ends))
            weighted_gap_minutes += max(0, max(ends) - min(starts) - busy_minutes) * enrollment[batch]
            student_days_on_campus += enrollment[batch]

    return {
        "estimatedStudentGapMinutes": weighted_gap_minutes,
        "estimatedStudentDaysOnCampus": student_days_on_campus,
        "estimatedStudents": sum(enrollment.values()),
    }


def build_and_solve(request: GenerationRequest, profile: str, exclusions: list[set[tuple]]) -> dict:
    model = cp_model.CpModel()
    slots_per_day = request.endHour - request.startHour
    if slots_per_day <= 0:
        raise HTTPException(status_code=422, detail="End time must be later than start time.")

    days = [day for day in DAY_ORDER if day in request.workingDays]
    rooms = [room for room in request.rooms if room.type == "lab" or room.capacity > 0]
    sessions = []
    for course_index, course in enumerate(request.courses):
        eligible_days = [day for day in days if not course.availableDays or day in course.availableDays]
        if course.durationHours > slots_per_day or not eligible_days:
            raise HTTPException(status_code=422, detail=f"{course.courseCode} has no eligible time window.")
        if (
            course.availableFromHour is not None
            and course.availableUntilHour is not None
            and course.availableUntilHour <= course.availableFromHour
        ):
            raise HTTPException(status_code=422, detail=f"{course.courseCode} has an invalid faculty availability window.")
        for occurrence in range(course.sessionsPerWeek):
            sessions.append((course_index, occurrence, course, eligible_days))

    if len(sessions) > 240:
        raise HTTPException(status_code=422, detail="This request exceeds the 240-session limit.")
    estimated_candidates = 0
    for _, _, course, eligible_days in sessions:
        eligible_starts = sum(
            (course.availableFromHour is None or request.startHour + offset >= course.availableFromHour)
            and (course.availableUntilHour is None or request.startHour + offset + course.durationHours <= course.availableUntilHour)
            for offset in range(slots_per_day - course.durationHours + 1)
        )
        eligible_rooms = sum(
            room.type == course.roomType and (course.roomType == "lab" or room.capacity >= course.students)
            for room in rooms
        )
        estimated_candidates += len(eligible_days) * eligible_starts * eligible_rooms
    if estimated_candidates > 100000:
        raise HTTPException(status_code=422, detail="Too many possible assignments; reduce the number of courses, rooms, or working hours.")

    assignments = {}
    resource_intervals = defaultdict(list)
    variables = {}
    session_candidates = defaultdict(list)
    for session_index, (course_index, _, course, eligible_days) in enumerate(sessions):
        matching_rooms = [
            room for room in rooms
            if room.type == course.roomType and (course.roomType == "lab" or room.capacity >= course.students)
        ]
        if not matching_rooms:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"No classroom has enough capacity for {course.courseCode} ({course.students} students)."
                    if course.roomType == "classroom"
                    else f"No lab is available for {course.courseCode}."
                ),
            )

        for day_index, day in enumerate(days):
            if day not in eligible_days:
                continue
            for start_offset in range(slots_per_day - course.durationHours + 1):
                start_hour = request.startHour + start_offset
                if course.availableFromHour is not None and start_hour < course.availableFromHour:
                    continue
                if course.availableUntilHour is not None and start_hour + course.durationHours > course.availableUntilHour:
                    continue
                start_minute = request.startHour * 60 + start_offset * 60
                end_minute = start_minute + course.durationHours * 60
                for room_index, room in enumerate(matching_rooms):
                    key = (session_index, day, start_minute, room.name)
                    selected = model.NewBoolVar(f"x_{session_index}_{day}_{start_offset}_{room_index}")
                    interval = model.NewOptionalIntervalVar(
                        start_minute,
                        course.durationHours * 60,
                        end_minute,
                        selected,
                        f"i_{session_index}_{day}_{start_offset}_{room_index}",
                    )
                    variables[key] = selected
                    session_candidates[session_index].append(selected)
                    assignments[key] = {
                        "sessionIndex": session_index,
                        "courseIndex": course_index,
                        "day": day,
                        "dayIndex": day_index,
                        "startMinute": start_minute,
                        "startOffset": start_offset,
                        "room": room.name,
                    }
                    for resource in (
                        ("faculty", course.facultyName, day),
                        ("batch", course.batch, day),
                        ("room", room.name, day),
                    ):
                        resource_intervals[resource].append(interval)

    for candidate_vars in session_candidates.values():
        model.AddExactlyOne(candidate_vars)
    for intervals in resource_intervals.values():
        model.AddNoOverlap(intervals)

    # Identical weekly sessions are interchangeable; ordering their start times
    # avoids treating a permutation of the same timetable as a new alternative.
    repeated_sessions = defaultdict(list)
    for index, (course_index, _, _, _) in enumerate(sessions):
        repeated_sessions[course_index].append(index)
    for indexes in repeated_sessions.values():
        for earlier, later in zip(indexes, indexes[1:]):
            earlier_start = model.NewIntVar(0, len(days) * slots_per_day, f"s_{earlier}")
            later_start = model.NewIntVar(0, len(days) * slots_per_day, f"s_{later}")
            model.Add(earlier_start == sum(
                (entry["dayIndex"] * slots_per_day + entry["startOffset"]) * variables[key]
                for key, entry in assignments.items() if entry["sessionIndex"] == earlier
            ))
            model.Add(later_start == sum(
                (entry["dayIndex"] * slots_per_day + entry["startOffset"]) * variables[key]
                for key, entry in assignments.items() if entry["sessionIndex"] == later
            ))
            model.Add(earlier_start <= later_start)

    for excluded in exclusions:
        excluded_vars = [variables[key] for key in excluded if key in variables]
        if excluded_vars:
            model.Add(sum(excluded_vars) <= len(sessions) - 1)

    penalties = []
    room_usage = defaultdict(list)
    faculty_daily = defaultdict(list)
    batch_daily = defaultdict(list)
    batch_enrollment = {
        batch: max(course.students for course in request.courses if course.batch == batch)
        for batch in {course.batch for course in request.courses}
    }
    for key, entry in assignments.items():
        selected = variables[key]
        course = request.courses[entry["courseIndex"]]
        room = next(room for room in rooms if room.name == entry["room"])
        room_usage[room.name].append(selected)
        faculty_daily[(course.facultyName, entry["day"])].append(selected)
        batch_daily[(course.batch, entry["day"])].append((selected, course))

        late_penalty = max(0, entry["startOffset"] + course.durationHours - max(0, slots_per_day - 2))
        seat_waste = max(0, room.capacity - course.students) if course.roomType == "classroom" else 0
        if profile == "student-experience":
            early_penalty = max(0, 2 - entry["startOffset"])
            time_cost = (
                late_penalty * STUDENT_LATE_CLASS_COST_MINUTES
                + early_penalty * STUDENT_EARLY_CLASS_COST_MINUTES
            ) * course.students
            penalties.append(time_cost * selected)
        elif profile == "room-utilization":
            penalties.append(seat_waste * selected)
        else:
            penalties.append(late_penalty * selected)

    if profile == "student-experience":
        for batch_name in sorted({course.batch for course in request.courses}):
            for day in days:
                day_entries = [
                    (key, entry) for key, entry in assignments.items()
                    if entry["day"] == day and request.courses[entry["courseIndex"]].batch == batch_name
                ]
                day_vars = [variables[key] for key, _ in day_entries]
                day_has_classes = model.NewBoolVar(f"has_classes_{batch_name}_{day}")
                first_start = model.NewIntVar(0, request.endHour * 60, f"first_{batch_name}_{day}")
                last_end = model.NewIntVar(0, request.endHour * 60, f"last_{batch_name}_{day}")
                total_duration = sum(
                    request.courses[entry["courseIndex"]].durationHours * 60 * variables[key]
                    for key, entry in day_entries
                )
                for key, entry in day_entries:
                    selected = variables[key]
                    duration = request.courses[entry["courseIndex"]].durationHours * 60
                    model.Add(first_start <= entry["startMinute"]).OnlyEnforceIf(selected)
                    model.Add(last_end >= entry["startMinute"] + duration).OnlyEnforceIf(selected)
                if day_vars:
                    model.AddMaxEquality(day_has_classes, day_vars)
                else:
                    model.Add(day_has_classes == 0)
                model.Add(first_start == 0).OnlyEnforceIf(day_has_classes.Not())
                model.Add(last_end == 0).OnlyEnforceIf(day_has_classes.Not())
                gap_minutes = model.NewIntVar(0, (request.endHour - request.startHour) * 60, f"gaps_{batch_name}_{day}")
                model.Add(gap_minutes == last_end - first_start - total_duration)
                penalties.append(gap_minutes * batch_enrollment[batch_name])
                penalties.append(day_has_classes * STUDENT_EXTRA_CAMPUS_DAY_COST_MINUTES * batch_enrollment[batch_name])

    if profile == "room-utilization":
        room_open_vars = []
        for room_name, uses in room_usage.items():
            opened = model.NewBoolVar(f"room_used_{len(room_open_vars)}")
            model.AddMaxEquality(opened, uses)
            room_open_vars.append(opened * 3)
        penalties.extend(room_open_vars)

    if profile in ("student-experience", "faculty-balance"):
        grouped = batch_daily if profile == "student-experience" else faculty_daily
        owners = sorted({owner for owner, _ in grouped})
        for owner_index, owner in enumerate(owners):
            daily_counts = []
            for day in days:
                if profile == "student-experience":
                    count = model.NewIntVar(0, 960000, f"student_load_{owner_index}_{day}")
                    model.Add(count == sum(
                        course.students * course.durationHours * selected
                        for selected, course in grouped.get((owner, day), [])
                    ))
                else:
                    count = model.NewIntVar(0, len(sessions), f"load_{owner_index}_{day}")
                    model.Add(count == sum(grouped.get((owner, day), [])))
                daily_counts.append(count)
            load_upper_bound = 960000 if profile == "student-experience" else len(sessions)
            maximum = model.NewIntVar(0, load_upper_bound, f"max_load_{owner_index}")
            minimum = model.NewIntVar(0, load_upper_bound, f"min_load_{owner_index}")
            model.AddMaxEquality(maximum, daily_counts)
            model.AddMinEquality(minimum, daily_counts)
            if profile == "student-experience":
                penalties.append((maximum - minimum) * STUDENT_DAILY_LOAD_COST_MINUTES)
            else:
                penalties.append((maximum - minimum) * 12)

    model.Minimize(sum(penalties))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 8.0
    solver.parameters.num_search_workers = 8
    status_code = solver.Solve(model)
    status = solver.StatusName(status_code)
    if status not in ("OPTIMAL", "FEASIBLE"):
        return {"status": status, "assignments": [], "objectiveValue": None, "selectedKeys": []}

    selected_keys = [key for key, variable in variables.items() if solver.Value(variable)]
    output = []
    for key in selected_keys:
        entry = assignments[key]
        course = request.courses[entry["courseIndex"]]
        end_minute = entry["startMinute"] + course.durationHours * 60
        output.append({
            "dayOfWeek": entry["day"],
            "startTime": f"{entry['startMinute'] // 60:02d}:{entry['startMinute'] % 60:02d}",
            "endTime": f"{end_minute // 60:02d}:{end_minute % 60:02d}",
            "courseCode": course.courseCode,
            "courseName": course.courseName or course.courseCode,
            "facultyName": course.facultyName,
            "roomNo": entry["room"],
            "batch": course.batch,
            "students": course.students,
            "semester": request.semester,
            "program": request.program,
            "source": "generated",
            "rawText": f"{course.courseCode} {course.courseName} {entry['room']}",
            "slotType": "lab" if course.roomType == "lab" else "lecture",
        })
    output.sort(key=lambda item: (DAY_ORDER.index(item["dayOfWeek"]), item["startTime"], item["roomNo"]))
    return {
        "status": status,
        "assignments": output,
        "objectiveValue": solver.ObjectiveValue(),
        "studentMetrics": calculate_student_metrics(output),
        "selectedKeys": selected_keys,
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/generate")
def generate(request: GenerationRequest):
    if request.endHour <= request.startHour:
        raise HTTPException(status_code=422, detail="End time must be later than start time.")
    alternatives = []
    exclusions = []
    for profile in PROFILES:
        result = build_and_solve(request, profile, exclusions)
        if result["status"] in ("OPTIMAL", "FEASIBLE"):
            alternatives.append({
                "profile": profile,
                "status": result["status"],
                "assignments": result["assignments"],
                "objectiveValue": result["objectiveValue"],
                "studentMetrics": result["studentMetrics"],
            })
            exclusions.append(set(result["selectedKeys"]))
        elif not alternatives:
            return {"status": result["status"], "alternatives": []}
    return {"status": "FEASIBLE" if alternatives else "INFEASIBLE", "alternatives": alternatives}